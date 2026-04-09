#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [--tool amp|claude] [max_iterations]
#
# Each Claude iteration launches in its own terminal window with the
# full interactive TUI so you can watch it think and work. The main
# terminal stays clean with iteration status and summaries.

set -e

# Parse arguments
TOOL="amp"  # Default to amp for backwards compatibility
MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    *)
      # Assume it's max_iterations if it's a number
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# Validate tool choice
if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

cleanup() {
  echo ""
  echo "Ralph interrupted — cleaning up child processes..."
  # Kill any spawned terminal processes via their PID files
  for pidfile in "$SCRIPT_DIR"/.ralph-pid-*; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  done
  # Clean up temp files
  rm -f "$SCRIPT_DIR"/.ralph-sentinel-* "$SCRIPT_DIR"/.ralph-pid-* \
        "$SCRIPT_DIR"/.ralph-iter-*.sh "$SCRIPT_DIR"/.ralph-prompt-*.md \
        "$SCRIPT_DIR"/.ralph-summary-*
  exit 130
}
trap cleanup INT TERM

# Detect terminal emulator
if command -v gnome-terminal &>/dev/null; then
  TERMINAL="gnome-terminal"
elif command -v kitty &>/dev/null; then
  TERMINAL="kitty"
elif command -v alacritty &>/dev/null; then
  TERMINAL="alacritty"
elif command -v xterm &>/dev/null; then
  TERMINAL="xterm"
elif command -v konsole &>/dev/null; then
  TERMINAL="konsole"
else
  echo "Warning: No supported terminal emulator found. Falling back to inline mode."
  TERMINAL=""
fi

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    DATE=$(date +%Y-%m-%d)
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"

    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

echo "Starting Ralph - Tool: $TOOL - Max iterations: $MAX_ITERATIONS"

# Get the project root (one level up from ralph-tui/)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($TOOL)"
  echo "==============================================================="

  # Sentinel + summary + PID files for this iteration
  SENTINEL="$SCRIPT_DIR/.ralph-sentinel-$i"
  SUMMARY="$SCRIPT_DIR/.ralph-summary-$i"
  PIDFILE="$SCRIPT_DIR/.ralph-pid-$i"
  rm -f "$SENTINEL" "$SUMMARY" "$PIDFILE"

  if [[ "$TOOL" == "amp" ]]; then
    OUTPUT=$(cat "$SCRIPT_DIR/prompt.md" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true

    if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
      echo ""
      echo "Ralph completed all tasks!"
      echo "Completed at iteration $i of $MAX_ITERATIONS"
      exit 0
    fi

  elif [[ -n "$TERMINAL" ]]; then
    # Prepare a copy of CLAUDE.md with sentinel and summary paths baked in
    ITER_PROMPT="$SCRIPT_DIR/.ralph-prompt-$i.md"
    sed -e "s|__SENTINEL_PATH__|$SENTINEL|g" \
        -e "s|__SUMMARY_PATH__|$SUMMARY|g" \
        "$SCRIPT_DIR/CLAUDE.md" > "$ITER_PROMPT"

    # Build wrapper script that runs Claude with full interactive TUI
    WRAPPER="$SCRIPT_DIR/.ralph-iter-$i.sh"
    cat > "$WRAPPER" <<WRAPPER_EOF
#!/bin/bash
# Write the PID of this shell (i.e. the terminal's main process)
echo \$\$ > "$PIDFILE"
cd "$PROJECT_ROOT"

# Read the prepared system prompt
SYSTEM_PROMPT=\$(cat "$ITER_PROMPT")

# Run Claude interactively — full TUI, no stdin pipe, no --print
# --permission-mode bypassPermissions skips the permission mode dialog
# --dangerously-skip-permissions lets it work autonomously
claude \\
  --dangerously-skip-permissions \\
  --permission-mode bypassPermissions \\
  --system-prompt "\$SYSTEM_PROMPT" \\
  "Begin Ralph iteration $i of $MAX_ITERATIONS. Read the PRD and progress log, then work on the next story. Remember: NEVER ask questions, work fully autonomously, and write to the sentinel file when done."

# If Claude exits without writing the sentinel (e.g. crash, user closed),
# write DONE so the main loop doesn't hang forever
if [ ! -f "$SENTINEL" ]; then
  echo "DONE" > "$SENTINEL"
fi
WRAPPER_EOF
    chmod +x "$WRAPPER"

    # Launch in a new terminal window
    case "$TERMINAL" in
      gnome-terminal)
        gnome-terminal --title "Ralph #$i" -- bash "$WRAPPER"
        ;;
      kitty)
        kitty --title "Ralph #$i" bash "$WRAPPER" &
        ;;
      alacritty)
        alacritty --title "Ralph #$i" -e bash "$WRAPPER" &
        ;;
      xterm)
        xterm -title "Ralph #$i" -e bash "$WRAPPER" &
        ;;
      konsole)
        konsole -p tabtitle="Ralph #$i" -e bash "$WRAPPER" &
        ;;
    esac

    echo "  Claude TUI is running in a separate window..."
    echo "  Waiting for iteration to finish..."

    # Wait for the sentinel file (Claude writes it via Bash tool when done)
    while [ ! -f "$SENTINEL" ]; do
      sleep 2
    done

    RESULT=$(cat "$SENTINEL")

    # Kill the terminal window — Claude is done but the TUI is still waiting for input
    if [ -f "$PIDFILE" ]; then
      WRAPPER_PID=$(cat "$PIDFILE")
      # Remove from CHILD_PIDS since we're handling it now
      kill -- -"$WRAPPER_PID" 2>/dev/null || kill "$WRAPPER_PID" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi

    # Print the iteration summary if Claude wrote one
    if [ -f "$SUMMARY" ]; then
      cat "$SUMMARY"
    fi

    rm -f "$WRAPPER" "$ITER_PROMPT" "$SENTINEL" "$SUMMARY"

    if [[ "$RESULT" == *"COMPLETE"* ]]; then
      echo ""
      echo "Ralph completed all tasks!"
      echo "Completed at iteration $i of $MAX_ITERATIONS"
      exit 0
    fi

  else
    # Fallback: run inline (no separate terminal available)
    OUTPUT=$(claude --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" 2>&1 | tee /dev/stderr) || true

    if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
      echo ""
      echo "Ralph completed all tasks!"
      echo "Completed at iteration $i of $MAX_ITERATIONS"
      exit 0
    fi
  fi

  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
