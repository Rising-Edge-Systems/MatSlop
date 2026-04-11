/**
 * US-S05: Detect whether a MATLAB/Octave script buffer is a "function file" —
 * one whose first top-level statement is a `function` definition and therefore
 * executes no top-level code when you `run`/`source` it. These files are the
 * surprising case where clicking Run produces no visible output.
 *
 * Octave's rule: a file is a function file if (and only if) the first
 * non-blank, non-comment statement in the file is the keyword `function`.
 * Anything before the first `function` (blank lines, `%` line comments,
 * `#` shell-style comments, and `%{ ... %}` or `#{ ... #}` block comments)
 * does not change that classification.
 *
 * This is intentionally a pure, string-only heuristic: no tokenizer, no
 * dependency on Monaco. That keeps it trivially unit-testable and usable
 * from the Run button before the buffer has been saved.
 */
export function isFunctionOnlyFile(content: string): boolean {
  // Walk the file line-by-line, skipping blank lines, line comments, and
  // block comments. When we hit the first "real" line, decide based on
  // whether it begins with the `function` keyword.
  const lines = content.split(/\r?\n/)
  let inBlockComment = false
  // Block-comment delimiters in Octave must be the FIRST non-whitespace
  // tokens on their own line (`%{` / `%}` or `#{` / `#}`). We follow that
  // same rule here.
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (inBlockComment) {
      if (line === '%}' || line === '#}') {
        inBlockComment = false
      }
      continue
    }
    if (line === '') continue
    if (line === '%{' || line === '#{') {
      inBlockComment = true
      continue
    }
    // Single-line comments: `%...` or `#...`
    if (line.startsWith('%') || line.startsWith('#')) continue
    // First real line. Is it a `function` definition?
    return /^function\b/.test(line)
  }
  // All blank / all comments: nothing to run either — treat the same as a
  // function-only file so the user still gets the "nothing to run" banner
  // instead of silently sending an empty command.
  return true
}

/**
 * US-S05: Pure helper that builds the command string sent to Octave when
 * the editor Run button is clicked against a saved .m file. Uses
 * `source('<abs path>')` so the script executes in the caller's workspace
 * and its top-level output flows into the Command Window. A preceding
 * `cd('<dir>')` keeps relative paths inside the script working the same
 * way the old `run('<file>')` path did.
 *
 * Exported as a pure function so it can be unit-tested without spinning
 * up Electron / React / the IPC bridge.
 */
export interface RunScriptCommand {
  /** The full command string to execute. */
  command: string
  /** Short human-friendly echo for the Command Window history. */
  display: string
}

export function buildRunScriptCommand(
  filePath: string,
  dirPath: string
): RunScriptCommand {
  const sepIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const fileName = filePath.substring(sepIdx + 1)
  const escapedDir = dirPath.replace(/'/g, "''")
  const escapedAbsPath = filePath.replace(/'/g, "''")
  const escapedFile = fileName.replace(/'/g, "''")
  return {
    command: `cd('${escapedDir}'); source('${escapedAbsPath}')`,
    display: `source('${escapedFile}')`,
  }
}
