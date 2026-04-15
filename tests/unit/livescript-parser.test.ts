import { describe, it, expect } from 'vitest'
import {
  parseLiveScript,
  serializeLiveScript,
  createEmptyLiveScript,
  type LiveScriptDocument,
} from '../../src/renderer/editor/editorTypes'

describe('LiveScript parser', () => {
  it('createEmptyLiveScript returns valid JSON with markdown title and code cell', () => {
    const empty = createEmptyLiveScript()
    const doc = parseLiveScript(empty)
    expect(doc.cells.length).toBe(2)
    expect(doc.cells[0].type).toBe('markdown')
    expect(doc.cells[1].type).toBe('code')
  })

  it('parses a multi-cell document', () => {
    const json = JSON.stringify({
      cells: [
        { type: 'markdown', content: '# Title', output: '' },
        { type: 'code', content: 'x = 1', output: '' },
      ],
    })
    const doc = parseLiveScript(json)
    expect(doc.cells.length).toBe(2)
    expect(doc.cells[0].type).toBe('markdown')
    expect(doc.cells[1].content).toBe('x = 1')
  })

  it('returns default doc on invalid JSON', () => {
    const doc = parseLiveScript('not json {{{')
    expect(doc.cells.length).toBe(1)
    expect(doc.cells[0].type).toBe('code')
  })

  it('returns default doc when cells field is missing', () => {
    const doc = parseLiveScript('{"other": "data"}')
    expect(doc.cells.length).toBe(1)
  })

  it('round-trips serialize -> parse', () => {
    const original: LiveScriptDocument = {
      cells: [
        { type: 'markdown', content: '# Test', output: '' },
        { type: 'code', content: 'a = 5;\nb = 10;', output: 'a = 5\nb = 10' },
      ],
    }
    const serialized = serializeLiveScript(original)
    const parsed = parseLiveScript(serialized)
    expect(parsed.cells).toEqual(original.cells)
  })

  it('preserves figures field on round-trip', () => {
    const doc: LiveScriptDocument = {
      cells: [
        {
          type: 'code',
          content: 'plot(1:10)',
          output: '',
          figures: [{ imageDataUrl: 'data:image/png;base64,abc', tempPath: '/tmp/x.png' }],
        },
      ],
    }
    const parsed = parseLiveScript(serializeLiveScript(doc))
    expect(parsed.cells[0].figures).toBeDefined()
    expect(parsed.cells[0].figures?.[0].imageDataUrl).toBe('data:image/png;base64,abc')
  })
})
