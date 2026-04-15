# Ralph Wiggum - Long-running AI agent loop (Windows port)
# Usage: powershell -ExecutionPolicy Bypass -File .\ralph.ps1 [-Tool amp|claude] [-MaxIterations N]
#        pwsh .\ralph.ps1 -Tool claude -MaxIterations 10
#
# Each Claude iteration launches in its own PowerShell window with the
# full interactive TUI so you can watch it think and work. The main
# console stays clean with iteration status and summaries. When the
# iteration finishes (sentinel file appears) the child window is closed
# before the next iteration is launched.

[CmdletBinding()]
param(
    [ValidateSet('amp','claude')]
    [string]$Tool = 'amp',
    [int]$MaxIterations = 10
)

$ErrorActionPreference = 'Stop'

$ScriptDir      = $PSScriptRoot
$PrdFile        = Join-Path $ScriptDir 'prd.json'
$ProgressFile   = Join-Path $ScriptDir 'progress.txt'
$ArchiveDir     = Join-Path $ScriptDir 'archive'
$LastBranchFile = Join-Path $ScriptDir '.last-branch'

function ConvertTo-BashPath {
    param([string]$Path)
    # Bash on Windows (Git Bash / Claude Code's bash) accepts forward-slash paths.
    return ($Path -replace '\\','/')
}

function Escape-PsSingleQuoted {
    param([string]$s)
    return $s.Replace("'","''")
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    if (-not $ProcessId) { return }
    & taskkill.exe /F /T /PID $ProcessId 2>$null | Out-Null
}

function Invoke-Cleanup {
    Write-Host ""
    Write-Host "Ralph interrupted - cleaning up child processes..."
    Get-ChildItem -Path $ScriptDir -Filter '.ralph-pid-*' -ErrorAction SilentlyContinue | ForEach-Object {
        $childPid = (Get-Content $_.FullName -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($childPid) { Stop-ProcessTree -ProcessId ([int]$childPid) }
    }
    Get-ChildItem -Path $ScriptDir -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\.ralph-(sentinel|pid|iter|prompt|summary)-' } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

# Note: Ctrl+C will terminate the script; leftover .ralph-* temp files
# can be cleaned up manually or by re-running the script.

# Validate tool
if ($Tool -ne 'amp' -and $Tool -ne 'claude') {
    Write-Error "Invalid tool '$Tool'. Must be 'amp' or 'claude'."
    exit 1
}

# Archive previous run if branch changed
if ((Test-Path $PrdFile) -and (Test-Path $LastBranchFile)) {
    $currentBranch = ''
    try {
        $prd = Get-Content $PrdFile -Raw | ConvertFrom-Json
        if ($prd.PSObject.Properties.Name -contains 'branchName') {
            $currentBranch = [string]$prd.branchName
        }
    } catch {}
    $lastBranch = ''
    try { $lastBranch = (Get-Content $LastBranchFile -Raw -ErrorAction SilentlyContinue).Trim() } catch {}

    if ($currentBranch -and $lastBranch -and ($currentBranch -ne $lastBranch)) {
        $date = Get-Date -Format 'yyyy-MM-dd'
        $folderName = $lastBranch -replace '^ralph/',''
        $archiveFolder = Join-Path $ArchiveDir "$date-$folderName"
        Write-Host "Archiving previous run: $lastBranch"
        New-Item -ItemType Directory -Path $archiveFolder -Force | Out-Null
        if (Test-Path $PrdFile)      { Copy-Item $PrdFile      $archiveFolder }
        if (Test-Path $ProgressFile) { Copy-Item $ProgressFile $archiveFolder }
        Write-Host "   Archived to: $archiveFolder"

        "# Ralph Progress Log" | Set-Content $ProgressFile
        "Started: $(Get-Date)" | Add-Content $ProgressFile
        "---"                  | Add-Content $ProgressFile
    }
}

# Track current branch
if (Test-Path $PrdFile) {
    try {
        $prd = Get-Content $PrdFile -Raw | ConvertFrom-Json
        if ($prd.PSObject.Properties.Name -contains 'branchName' -and $prd.branchName) {
            [string]$prd.branchName | Set-Content $LastBranchFile
        }
    } catch {}
}

# Initialize progress file
if (-not (Test-Path $ProgressFile)) {
    "# Ralph Progress Log" | Set-Content $ProgressFile
    "Started: $(Get-Date)" | Add-Content $ProgressFile
    "---"                  | Add-Content $ProgressFile
}

Write-Host "Starting Ralph - Tool: $Tool - Max iterations: $MaxIterations"

# Get the project root (matches bash: two levels up from scripts/ralph/)
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

for ($i = 1; $i -le $MaxIterations; $i++) {
    Write-Host ""
    Write-Host "==============================================================="
    Write-Host "  Ralph Iteration $i of $MaxIterations ($Tool)"
    Write-Host "==============================================================="

    $Sentinel = Join-Path $ScriptDir ".ralph-sentinel-$i"
    $Summary  = Join-Path $ScriptDir ".ralph-summary-$i"
    $PidFile  = Join-Path $ScriptDir ".ralph-pid-$i"
    Remove-Item $Sentinel,$Summary,$PidFile -ErrorAction SilentlyContinue

    if ($Tool -eq 'amp') {
        $promptPath = Join-Path $ScriptDir 'prompt.md'
        $output = (Get-Content $promptPath -Raw) | & amp --dangerously-allow-all 2>&1
        $output | ForEach-Object { Write-Host $_ }

        if (($output -join "`n") -match '<promise>COMPLETE</promise>') {
            Write-Host ""
            Write-Host "Ralph completed all tasks!"
            Write-Host "Completed at iteration $i of $MaxIterations"
            exit 0
        }
    }
    else {
        # Prepare a copy of CLAUDE.md with sentinel and summary paths baked in.
        # Use forward-slash paths so the bash heredocs in CLAUDE.md work under
        # Claude Code's bash on Windows.
        $iterPrompt   = Join-Path $ScriptDir ".ralph-prompt-$i.md"
        $sentinelBash = ConvertTo-BashPath $Sentinel
        $summaryBash  = ConvertTo-BashPath $Summary

        $tpl = Get-Content (Join-Path $ScriptDir 'CLAUDE.md') -Raw
        $tpl = $tpl.Replace('__SENTINEL_PATH__', $sentinelBash).Replace('__SUMMARY_PATH__', $summaryBash)
        Set-Content -Path $iterPrompt -Value $tpl -NoNewline -Encoding UTF8

        # Build a wrapper PowerShell script that runs Claude with the full interactive TUI.
        $wrapper = Join-Path $ScriptDir ".ralph-iter-$i.ps1"
        $beginMsg = "Begin Ralph iteration $i of $MaxIterations. Read the PRD and progress log, then work on the next story. Remember: NEVER ask questions, work fully autonomously, and write to the sentinel file when done."

        $iterPromptEsc = Escape-PsSingleQuoted $iterPrompt
        $sentinelEsc   = Escape-PsSingleQuoted $Sentinel
        $projectRootEsc = Escape-PsSingleQuoted $ProjectRoot
        $beginMsgEsc   = Escape-PsSingleQuoted $beginMsg

        $wrapperContent = @"
`$Host.UI.RawUI.WindowTitle = 'Ralph #$i'
Set-Location -LiteralPath '$projectRootEsc'

# Read the prepared system prompt
`$systemPrompt = Get-Content -Raw -LiteralPath '$iterPromptEsc'

# Run Claude interactively - full TUI, no stdin pipe, no --print
# --dangerously-skip-permissions lets it work autonomously
& claude ``
    --dangerously-skip-permissions ``
    --permission-mode bypassPermissions ``
    --system-prompt `$systemPrompt ``
    '$beginMsgEsc'

# If Claude exits without writing the sentinel (e.g. crash, user closed),
# write DONE so the main loop does not hang forever.
if (-not (Test-Path -LiteralPath '$sentinelEsc')) {
    'DONE' | Set-Content -LiteralPath '$sentinelEsc'
}
"@
        Set-Content -Path $wrapper -Value $wrapperContent -Encoding UTF8

        # Launch in a new PowerShell window
        $proc = Start-Process -FilePath 'powershell.exe' `
            -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$wrapper) `
            -PassThru
        $proc.Id | Set-Content $PidFile

        Write-Host "  Claude TUI is running in a separate window (PID $($proc.Id))..."
        Write-Host "  Waiting for iteration to finish..."

        # Wait for the sentinel file (Claude writes it via Bash tool when done)
        while (-not (Test-Path -LiteralPath $Sentinel)) {
            Start-Sleep -Seconds 2
        }

        $result = (Get-Content -LiteralPath $Sentinel -Raw)

        # Kill the terminal window - Claude is done but the TUI is still waiting for input.
        # /T kills the entire process tree (powershell -> claude -> children).
        if (Test-Path $PidFile) {
            $wrapperPid = [int](Get-Content $PidFile | Select-Object -First 1)
            Stop-ProcessTree -ProcessId $wrapperPid
            Remove-Item $PidFile -ErrorAction SilentlyContinue
        }

        # Print the iteration summary if Claude wrote one
        if (Test-Path $Summary) {
            Get-Content $Summary | ForEach-Object { Write-Host $_ }
        }

        Remove-Item $wrapper,$iterPrompt,$Sentinel,$Summary -ErrorAction SilentlyContinue

        if ($result -match 'COMPLETE') {
            Write-Host ""
            Write-Host "Ralph completed all tasks!"
            Write-Host "Completed at iteration $i of $MaxIterations"
            exit 0
        }
    }

    Write-Host "Iteration $i complete. Continuing..."
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Ralph reached max iterations ($MaxIterations) without completing all tasks."
Write-Host "Check $ProgressFile for status."
exit 1
