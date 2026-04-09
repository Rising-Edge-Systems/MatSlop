import type { editor as monacoEditor } from 'monaco-editor'

export interface MatlabDiagnostic {
  line: number
  startColumn: number
  endColumn: number
  message: string
  severity: 'error' | 'warning'
}

// Block-opening keywords that require a matching 'end'
const BLOCK_OPENERS = new Set([
  'function',
  'if',
  'for',
  'while',
  'switch',
  'try',
  'classdef',
  'parfor',
  'spmd',
  'methods',
  'properties',
  'events',
  'enumeration',
])

// Keywords that are part of a block but don't open a new one
const BLOCK_CONTINUATIONS = new Set(['else', 'elseif', 'case', 'otherwise', 'catch'])

interface BracketInfo {
  char: string
  line: number
  column: number
}

interface BlockInfo {
  keyword: string
  line: number
  column: number
}

/**
 * Check for unclosed/mismatched brackets and parentheses.
 * Skips content inside strings and comments.
 */
function checkBrackets(lines: string[]): MatlabDiagnostic[] {
  const diagnostics: MatlabDiagnostic[] = []
  const stack: BracketInfo[] = []
  const matchingClose: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const matchingOpen: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let inSingleString = false
    let inDoubleString = false
    let inBlockComment = false

    // Check if we're continuing a block comment
    // (simplified: block comments on their own lines with %{ and %})
    if (line.trimStart().startsWith('%{')) {
      inBlockComment = true
    }
    if (inBlockComment) {
      if (line.trimStart().startsWith('%}')) {
        inBlockComment = false
      }
      continue
    }

    for (let j = 0; j < line.length; j++) {
      const ch = line[j]

      // Handle strings
      if (!inDoubleString && ch === "'" && !inSingleString) {
        // Check if it's a transpose operator (preceded by identifier, number, ), ], })
        if (j > 0) {
          const prev = line[j - 1]
          if (/[a-zA-Z0-9_)\]}.']/.test(prev)) {
            continue // transpose, not string start
          }
        }
        inSingleString = true
        continue
      }
      if (inSingleString) {
        if (ch === "'") {
          if (j + 1 < line.length && line[j + 1] === "'") {
            j++ // escaped quote
          } else {
            inSingleString = false
          }
        }
        continue
      }

      if (!inSingleString && ch === '"' && !inDoubleString) {
        inDoubleString = true
        continue
      }
      if (inDoubleString) {
        if (ch === '"') {
          if (j + 1 < line.length && line[j + 1] === '"') {
            j++ // escaped quote
          } else {
            inDoubleString = false
          }
        }
        continue
      }

      // Line comment — skip rest of line
      if (ch === '%') break

      // Handle brackets
      if (ch === '(' || ch === '[' || ch === '{') {
        stack.push({ char: ch, line: i + 1, column: j + 1 })
      } else if (ch === ')' || ch === ']' || ch === '}') {
        if (stack.length === 0) {
          diagnostics.push({
            line: i + 1,
            startColumn: j + 1,
            endColumn: j + 2,
            message: `Unexpected closing '${ch}' with no matching opening bracket`,
            severity: 'error',
          })
        } else {
          const top = stack[stack.length - 1]
          if (top.char !== matchingOpen[ch]) {
            diagnostics.push({
              line: i + 1,
              startColumn: j + 1,
              endColumn: j + 2,
              message: `Mismatched bracket: expected '${matchingClose[top.char]}' to close '${top.char}' at line ${top.line}, but found '${ch}'`,
              severity: 'error',
            })
            stack.pop()
          } else {
            stack.pop()
          }
        }
      }
    }
  }

  // Any remaining unclosed brackets
  for (const unclosed of stack) {
    diagnostics.push({
      line: unclosed.line,
      startColumn: unclosed.column,
      endColumn: unclosed.column + 1,
      message: `Unclosed '${unclosed.char}' — expected matching '${matchingClose[unclosed.char]}'`,
      severity: 'error',
    })
  }

  return diagnostics
}

/**
 * Check for mismatched function/end, if/end, for/end, while/end blocks.
 * Skips content inside strings and comments.
 */
function checkBlocks(lines: string[]): MatlabDiagnostic[] {
  const diagnostics: MatlabDiagnostic[] = []
  const stack: BlockInfo[] = []
  let inBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()

    // Handle block comments
    if (trimmed.startsWith('%{')) {
      inBlockComment = true
      continue
    }
    if (inBlockComment) {
      if (trimmed.startsWith('%}')) {
        inBlockComment = false
      }
      continue
    }

    // Skip line comments
    if (trimmed.startsWith('%')) continue

    // Remove string literals and inline comments before scanning for keywords
    const cleaned = removeStringsAndComments(line)

    // Tokenize to find keywords (word boundaries)
    const wordRegex = /\b([a-zA-Z_]\w*)\b/g
    let match: RegExpExecArray | null
    while ((match = wordRegex.exec(cleaned)) !== null) {
      const word = match[1]
      const col = match.index + 1

      if (BLOCK_OPENERS.has(word)) {
        stack.push({ keyword: word, line: i + 1, column: col })
      } else if (word === 'end') {
        if (stack.length === 0) {
          diagnostics.push({
            line: i + 1,
            startColumn: col,
            endColumn: col + 3,
            message: `Unexpected 'end' with no matching block opener`,
            severity: 'error',
          })
        } else {
          stack.pop()
        }
      } else if (BLOCK_CONTINUATIONS.has(word)) {
        // Continuations (else, elseif, case, etc.) should have a matching opener on the stack
        if (stack.length === 0) {
          diagnostics.push({
            line: i + 1,
            startColumn: col,
            endColumn: col + word.length,
            message: `'${word}' without a matching block opener`,
            severity: 'error',
          })
        }
      }
    }
  }

  // Any remaining unclosed blocks
  for (const unclosed of stack) {
    diagnostics.push({
      line: unclosed.line,
      startColumn: unclosed.column,
      endColumn: unclosed.column + unclosed.keyword.length,
      message: `Unclosed '${unclosed.keyword}' — expected matching 'end'`,
      severity: 'error',
    })
  }

  return diagnostics
}

/**
 * Remove string literals and comments from a line for keyword scanning.
 */
function removeStringsAndComments(line: string): string {
  const chars: string[] = []
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (!inSingle && !inDouble && ch === '%') {
      // Rest is comment — fill with spaces to preserve positions
      for (let j = i; j < line.length; j++) chars.push(' ')
      break
    }

    if (!inDouble && ch === "'" && !inSingle) {
      // Check for transpose
      if (i > 0 && /[a-zA-Z0-9_)\]}.']/.test(line[i - 1])) {
        chars.push(ch)
        continue
      }
      inSingle = true
      chars.push(' ')
      continue
    }
    if (inSingle) {
      if (ch === "'") {
        if (i + 1 < line.length && line[i + 1] === "'") {
          chars.push(' ')
          chars.push(' ')
          i++
        } else {
          inSingle = false
          chars.push(' ')
        }
      } else {
        chars.push(' ')
      }
      continue
    }

    if (!inSingle && ch === '"' && !inDouble) {
      inDouble = true
      chars.push(' ')
      continue
    }
    if (inDouble) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          chars.push(' ')
          chars.push(' ')
          i++
        } else {
          inDouble = false
          chars.push(' ')
        }
      } else {
        chars.push(' ')
      }
      continue
    }

    chars.push(ch)
  }

  return chars.join('')
}

/**
 * Run all MATLAB diagnostics on the given source code.
 */
export function analyzeMatlabCode(code: string): MatlabDiagnostic[] {
  const lines = code.split('\n')
  const diagnostics: MatlabDiagnostic[] = []
  diagnostics.push(...checkBrackets(lines))
  diagnostics.push(...checkBlocks(lines))
  return diagnostics
}

/**
 * Convert MatlabDiagnostics to Monaco editor markers.
 */
export function diagnosticsToMarkers(
  diagnostics: MatlabDiagnostic[],
  monacoSeverity: { Error: number; Warning: number }
): monacoEditor.IMarkerData[] {
  return diagnostics.map((d) => ({
    startLineNumber: d.line,
    startColumn: d.startColumn,
    endLineNumber: d.line,
    endColumn: d.endColumn,
    message: d.message,
    severity: d.severity === 'error' ? monacoSeverity.Error : monacoSeverity.Warning,
  }))
}
