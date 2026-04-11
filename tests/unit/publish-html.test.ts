import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  highlightMatlab,
  renderMarkdown,
  publishHtml,
  renderScriptBody,
  renderLiveScriptBody,
  renderCellHtml,
  renderCellOutputs,
  renderFigureHtml,
} from '../../src/renderer/editor/publishHtml'
import {
  serializeLiveScript,
  type LiveScriptDocument,
} from '../../src/renderer/editor/editorTypes'

describe('escapeHtml', () => {
  it('escapes html-significant characters', () => {
    expect(escapeHtml('<a href="x">Tom & Jerry</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;',
    )
  })
})

describe('highlightMatlab', () => {
  it('highlights keywords', () => {
    const html = highlightMatlab('if x > 0\n  disp("hi")\nend')
    expect(html).toContain('<span class="kw">if</span>')
    expect(html).toContain('<span class="kw">end</span>')
  })

  it('escapes < and > inside code', () => {
    const html = highlightMatlab('a<b')
    expect(html).toContain('a&lt;b')
    expect(html).not.toContain('<b')
  })

  it('highlights line comments', () => {
    const html = highlightMatlab('% hello\nx=1')
    expect(html).toContain('<span class="com">% hello</span>')
  })

  it('highlights double-quoted strings with special chars', () => {
    const html = highlightMatlab('disp("<hi>")')
    expect(html).toContain('<span class="str">&quot;&lt;hi&gt;&quot;</span>')
  })

  it('highlights numbers', () => {
    const html = highlightMatlab('x = 3.14e-2;')
    expect(html).toContain('<span class="num">3.14e-2</span>')
  })

  it('does not treat transpose apostrophe as string start', () => {
    const html = highlightMatlab("A' * b")
    // The lone ' after A should NOT open an unterminated string span.
    expect(html).not.toContain('<span class="str">&#39;')
  })

  it('produces no unescaped tags from arbitrary user code', () => {
    const evil = '% <script>alert(1)</script>\nfoo(\'<img onerror=1>\')'
    const html = highlightMatlab(evil)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img ')
  })
})

describe('renderMarkdown', () => {
  it('renders headings and paragraphs', () => {
    const out = renderMarkdown('# Title\n\nHello world')
    expect(out).toContain('<h1>Title</h1>')
    expect(out).toContain('<p>Hello world</p>')
  })

  it('applies bold and italic', () => {
    const out = renderMarkdown('**bold** and *italic*')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
  })

  it('escapes html in markdown', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})

describe('renderFigureHtml', () => {
  it('embeds base64 image into img tag', () => {
    const html = renderFigureHtml({
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      tempPath: '/tmp/x.png',
    })
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
  })

  it('returns empty string when imageDataUrl missing', () => {
    expect(renderFigureHtml({ imageDataUrl: '', tempPath: '' })).toBe('')
  })
})

describe('renderCellOutputs', () => {
  it('prefers per-statement results', () => {
    const out = renderCellOutputs({
      type: 'code',
      content: 'x = 1\nx = 2',
      output: 'IGNORED',
      statementResults: [
        { startLine: 1, lineCount: 1, output: 'first' },
        { startLine: 2, lineCount: 1, output: 'second' },
      ],
    })
    expect(out).toContain('first')
    expect(out).toContain('second')
    expect(out).not.toContain('IGNORED')
  })

  it('marks error output with ms-error class', () => {
    const out = renderCellOutputs({
      type: 'code',
      content: 'boom',
      output: '',
      statementResults: [
        { startLine: 1, lineCount: 1, output: 'error!', isError: true },
      ],
    })
    expect(out).toContain('class="ms-output ms-error"')
  })

  it('falls back to cell-level output when no statementResults', () => {
    const out = renderCellOutputs({
      type: 'code',
      content: 'x=1',
      output: 'hello',
    })
    expect(out).toContain('hello')
  })

  it('shows (no output) placeholder when nothing to render', () => {
    const out = renderCellOutputs({ type: 'code', content: '', output: '' })
    expect(out).toContain('(no output)')
  })
})

describe('renderCellHtml', () => {
  it('renders markdown cells without code/output grid cells', () => {
    const html = renderCellHtml({
      type: 'markdown',
      content: '# Heading',
      output: '',
    })
    expect(html).toContain('ms-cell-md')
    expect(html).toContain('<h1>Heading</h1>')
    expect(html).not.toContain('ms-cell-code')
  })
})

describe('publishHtml', () => {
  it('builds a full HTML doc for a script', () => {
    const html = publishHtml({
      filename: 'demo.m',
      mode: 'script',
      content: '% Hello\nx = 1;\ndisp(x)',
      scriptOutput: '1',
      timestamp: '2026-04-11T00:00:00Z',
    })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<title>demo.m</title>')
    expect(html).toContain('<h1>demo.m</h1>')
    expect(html).toContain('<span class="com">% Hello</span>')
    // scriptOutput appears
    expect(html).toContain('class="ms-output"')
    expect(html).toContain('>1</pre>')
    // Timestamp shown
    expect(html).toContain('Published 2026-04-11T00:00:00Z')
    // No <script> tags: the output must be JS-free for portability.
    expect(html).not.toMatch(/<script\b/i)
  })

  it('renders a livescript with cell layout, outputs, and embedded figure', () => {
    const doc: LiveScriptDocument = {
      cells: [
        { type: 'markdown', content: '# Intro', output: '' },
        {
          type: 'code',
          content: 'x = 1 + 2',
          output: 'x = 3',
          figures: [
            {
              imageDataUrl: 'data:image/png;base64,AAAA',
              tempPath: '/tmp/a.png',
            },
          ],
        },
      ],
    }
    const html = publishHtml({
      filename: 'demo.mls',
      mode: 'livescript',
      content: serializeLiveScript(doc),
    })
    expect(html).toContain('<title>demo.mls</title>')
    expect(html).toContain('ms-cells')
    expect(html).toContain('<h1>Intro</h1>')
    expect(html).toContain('ms-cell-code')
    expect(html).toContain('ms-cell-out')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).not.toMatch(/<script\b/i)
  })

  it('renderScriptBody omits output block when no scriptOutput', () => {
    const body = renderScriptBody('x = 1')
    expect(body).not.toContain('ms-output')
  })

  it('renderLiveScriptBody tolerates malformed JSON by rendering empty default', () => {
    const body = renderLiveScriptBody('not json')
    expect(body).toContain('ms-cells')
  })
})
