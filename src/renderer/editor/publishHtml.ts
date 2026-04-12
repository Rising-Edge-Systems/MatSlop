/**
 * US-030: Publish to HTML.
 *
 * Pure helpers that convert an editor tab (a .m script or a .mls live
 * script) into a self-contained HTML document — no JavaScript, no
 * external resources, suitable for emailing / hosting / archiving.
 *
 * Design notes:
 *   - The module has NO React / DOM / Electron imports so it can be
 *     unit-tested in vitest's node environment.
 *   - Syntax highlighting is done with a minimal lexer that emits
 *     `<span class="kw">` / `.str` / `.com` / `.num` wrappers. CSS is
 *     inlined into the document so the output is a single file.
 *   - Live-script cells are rendered as a 2-column grid mirroring the
 *     in-app live editor (code left, output right). Figures are embedded
 *     via the `imageDataUrl` that live-script cells already carry
 *     (persisted into the .mls JSON on run/save — see stripIds in
 *     LiveScriptEditor.tsx).
 *   - `parseLiveScript(content)` returns a `LiveScriptDocument`; this
 *     module consumes that shape directly rather than the runtime
 *     `CellWithId` augmented shape, so callers pass the serialized
 *     content (the tab's `content` field).
 */

import {
  parseLiveScript,
  type LiveScriptCell,
  type LiveScriptCellFigure,
} from './editorTypes'

// ---------- HTML escaping -----------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------- MATLAB / Octave syntax highlighter --------------------------

const MATLAB_KEYWORDS = new Set([
  'if', 'else', 'elseif', 'end', 'endif', 'endfor', 'endwhile',
  'endfunction', 'endswitch', 'end_try_catch', 'endparfor',
  'end_unwind_protect', 'endclassdef', 'for', 'while', 'do', 'until',
  'function', 'return', 'break', 'continue', 'switch', 'case',
  'otherwise', 'try', 'catch', 'classdef', 'methods', 'properties',
  'events', 'enumeration', 'global', 'persistent', 'parfor', 'spmd',
  'unwind_protect', 'unwind_protect_cleanup',
])

/**
 * Minimal MATLAB/Octave highlighter. Walks the input character-by-character
 * and emits HTML with span wrappers around keywords, strings, comments, and
 * numeric literals. Escapes all other text. Good enough for static
 * publish-to-HTML output (not a full parser).
 */
export function highlightMatlab(code: string): string {
  let out = ''
  let i = 0
  const n = code.length

  const isIdStart = (c: string): boolean => /[A-Za-z_]/.test(c)
  const isIdCont = (c: string): boolean => /[A-Za-z0-9_]/.test(c)
  const isDigit = (c: string): boolean => /[0-9]/.test(c)

  while (i < n) {
    const ch = code[i]

    // Line comments: % or # until end of line
    if (ch === '%' || ch === '#') {
      let j = i
      while (j < n && code[j] !== '\n') j++
      out += `<span class="com">${escapeHtml(code.slice(i, j))}</span>`
      i = j
      continue
    }

    // Single-quoted string (MATLAB: also transpose — but if the previous
    // non-space char is an identifier/closing paren, treat as transpose).
    if (ch === "'") {
      // Look back for transpose context.
      const k = out.length - 1
      // Strip any trailing tags to reach the last real char.
      // Simpler: scan input backward.
      let prev = ''
      for (let p = i - 1; p >= 0; p--) {
        if (code[p] !== ' ' && code[p] !== '\t') {
          prev = code[p]
          break
        }
      }
      void k
      if (prev && (isIdCont(prev) || prev === ')' || prev === ']' || prev === '}' || prev === '.')) {
        // Transpose, not a string.
        out += escapeHtml(ch)
        i++
        continue
      }
      let j = i + 1
      while (j < n) {
        if (code[j] === "'") {
          if (code[j + 1] === "'") { j += 2; continue } // escaped quote
          j++
          break
        }
        if (code[j] === '\n') { j++; break }
        j++
      }
      out += `<span class="str">${escapeHtml(code.slice(i, j))}</span>`
      i = j
      continue
    }

    // Double-quoted string (Octave style).
    if (ch === '"') {
      let j = i + 1
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue }
        if (code[j] === '"') { j++; break }
        if (code[j] === '\n') { j++; break }
        j++
      }
      out += `<span class="str">${escapeHtml(code.slice(i, j))}</span>`
      i = j
      continue
    }

    // Numeric literal
    if (isDigit(ch) || (ch === '.' && i + 1 < n && isDigit(code[i + 1]))) {
      let j = i
      while (j < n && /[0-9.eE+\-ij]/.test(code[j])) {
        // Only allow +/- after e/E
        if ((code[j] === '+' || code[j] === '-') && j > i) {
          const prev = code[j - 1]
          if (prev !== 'e' && prev !== 'E') break
        }
        j++
      }
      out += `<span class="num">${escapeHtml(code.slice(i, j))}</span>`
      i = j
      continue
    }

    // Identifier / keyword
    if (isIdStart(ch)) {
      let j = i + 1
      while (j < n && isIdCont(code[j])) j++
      const word = code.slice(i, j)
      if (MATLAB_KEYWORDS.has(word)) {
        out += `<span class="kw">${escapeHtml(word)}</span>`
      } else {
        out += escapeHtml(word)
      }
      i = j
      continue
    }

    // Default: escape single char
    out += escapeHtml(ch)
    i++
  }

  return out
}

// ---------- Minimal markdown renderer -----------------------------------

/**
 * Extremely small markdown subset: paragraphs, headings (#, ##, ###),
 * bold (**x**), italic (*x*), inline code (`x`). No lists / tables /
 * images. Sufficient for .mls markdown cells which tend to be short
 * explanatory prose. Escapes everything before applying inline rules so
 * output is always well-formed HTML.
 */
export function renderMarkdown(src: string): string {
  const lines = src.split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const joined = paragraph.join(' ')
    blocks.push(`<p>${applyInlineMarkdown(joined)}</p>`)
    paragraph = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flushParagraph()
      continue
    }
    const hMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (hMatch) {
      flushParagraph()
      const level = hMatch[1].length
      blocks.push(`<h${level}>${applyInlineMarkdown(hMatch[2])}</h${level}>`)
      continue
    }
    paragraph.push(trimmed)
  }
  flushParagraph()

  return blocks.join('\n')
}

function applyInlineMarkdown(line: string): string {
  // Escape first, then apply replacements that only match span markers
  // whose delimiter characters we haven't escaped (`, *).
  let s = escapeHtml(line)
  // Inline code `x`
  s = s.replace(/`([^`]+)`/g, (_m, g1) => `<code>${g1}</code>`)
  // Bold **x**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, g1) => `<strong>${g1}</strong>`)
  // Italic *x*
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_m, pre, g1) => `${pre}<em>${g1}</em>`)
  return s
}

// ---------- Document assembly -------------------------------------------

const BASE_CSS = `
:root {
  --fg: #24292f;
  --muted: #57606a;
  --bg: #ffffff;
  --code-bg: #f6f8fa;
  --border: #d0d7de;
  --kw: #cf222e;
  --str: #0a3069;
  --com: #6e7781;
  --num: #0550ae;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  color: var(--fg);
  background: var(--bg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
body { padding: 32px 48px; max-width: 1200px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px 0; }
.ms-meta { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
pre, code, .ms-code, .ms-output {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 12.5px;
}
.ms-code {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 16px;
  margin: 0;
  white-space: pre;
  overflow-x: auto;
}
.ms-output {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 3px solid #8250df;
  border-radius: 0 6px 6px 0;
  padding: 10px 14px;
  margin: 0;
  white-space: pre-wrap;
  color: var(--fg);
  overflow-x: auto;
}
.ms-output.ms-error { border-left-color: #cf222e; color: #82071e; background: #ffebe9; }
.ms-figure { margin: 8px 0; }
.ms-figure img { max-width: 100%; border: 1px solid var(--border); border-radius: 4px; }
.ms-cells {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px 16px;
  align-items: start;
}
.ms-cell-code { grid-column: 1; }
.ms-cell-out { grid-column: 2; }
.ms-cell-md { grid-column: 1 / -1; padding: 6px 0; }
.ms-cell-md h1, .ms-cell-md h2, .ms-cell-md h3 { margin: 12px 0 6px; }
.ms-cell-md p { margin: 6px 0; }
.ms-cell-md code {
  background: var(--code-bg);
  padding: 1px 4px;
  border-radius: 3px;
}
.ms-empty-out { color: var(--muted); font-style: italic; padding: 10px 14px; }
.kw { color: var(--kw); font-weight: 600; }
.str { color: var(--str); }
.com { color: var(--com); font-style: italic; }
.num { color: var(--num); }
@media print {
  body { padding: 16px; }
  .ms-code, .ms-output { page-break-inside: avoid; }
}
`.trim()

export interface PublishInput {
  filename: string
  mode: 'script' | 'livescript'
  /** Raw file content. For livescript mode this is the serialized JSON. */
  content: string
  /**
   * Optional output captured for a .m script. Not used for livescripts
   * (they carry their outputs inside the cell JSON).
   */
  scriptOutput?: string
  /**
   * Optional publish timestamp (ISO). Kept as a parameter so unit tests
   * can produce deterministic output.
   */
  timestamp?: string
}

export function publishHtml(input: PublishInput): string {
  const body =
    input.mode === 'livescript'
      ? renderLiveScriptBody(input.content)
      : renderScriptBody(input.content, input.scriptOutput)

  const title = escapeHtml(input.filename)
  const meta = input.timestamp
    ? `<div class="ms-meta">Published ${escapeHtml(input.timestamp)} — MatSlop</div>`
    : `<div class="ms-meta">Published with MatSlop</div>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<h1>${title}</h1>
${meta}
${body}
</body>
</html>
`
}

// ---------- Script (.m) rendering ---------------------------------------

export function renderScriptBody(code: string, scriptOutput?: string): string {
  const codeHtml = highlightMatlab(code)
  const outHtml = scriptOutput && scriptOutput.length > 0
    ? `<pre class="ms-output">${escapeHtml(scriptOutput)}</pre>`
    : ''
  return `<pre class="ms-code">${codeHtml}</pre>\n${outHtml}`
}

// ---------- Live script (.mls) rendering --------------------------------

export function renderLiveScriptBody(serializedContent: string): string {
  const doc = parseLiveScript(serializedContent)
  const parts: string[] = ['<div class="ms-cells">']
  for (const cell of doc.cells) {
    parts.push(renderCellHtml(cell))
  }
  parts.push('</div>')
  return parts.join('\n')
}

export function renderCellHtml(cell: LiveScriptCell): string {
  if (cell.type === 'markdown') {
    return `<div class="ms-cell-md">${renderMarkdown(cell.content)}</div>`
  }
  const codeHtml = highlightMatlab(cell.content)
  const outputHtml = renderCellOutputs(cell)
  return (
    `<pre class="ms-code ms-cell-code">${codeHtml}</pre>\n` +
    `<div class="ms-cell-out">${outputHtml}</div>`
  )
}

/**
 * Render the output side of a code cell: per-statement results if we have
 * them, otherwise fall back to `cell.output` and `cell.figures`.
 */
export function renderCellOutputs(cell: LiveScriptCell): string {
  const blocks: string[] = []

  if (cell.statementResults && cell.statementResults.length > 0) {
    for (const r of cell.statementResults) {
      if (r.output && r.output.length > 0) {
        const cls = r.isError ? 'ms-output ms-error' : 'ms-output'
        blocks.push(`<pre class="${cls}">${escapeHtml(r.output)}</pre>`)
      }
      if (r.figures && r.figures.length > 0) {
        for (const fig of r.figures) {
          blocks.push(renderFigureHtml(fig))
        }
      }
    }
  } else {
    if (cell.output && cell.output.length > 0) {
      blocks.push(`<pre class="ms-output">${escapeHtml(cell.output)}</pre>`)
    }
    if (cell.figures && cell.figures.length > 0) {
      for (const fig of cell.figures) {
        blocks.push(renderFigureHtml(fig))
      }
    }
  }

  if (blocks.length === 0) {
    return '<div class="ms-empty-out">(no output)</div>'
  }
  return blocks.join('\n')
}

export function renderFigureHtml(fig: LiveScriptCellFigure): string {
  // imageDataUrl is a `data:image/png;base64,...` string — embed directly.
  // Escape the attribute value defensively in case the input has quotes.
  const src = escapeHtml(fig.imageDataUrl ?? '')
  if (!src) return ''
  return `<figure class="ms-figure"><img alt="figure" src="${src}"></figure>`
}
