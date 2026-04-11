import { describe, it, expect } from 'vitest'
import {
  parseDocCommand,
  parseHelpCommand,
  buildHelpFetchCommand,
  extractHelpBody,
  extractSeeAlso,
  splitHelpBody,
  EMPTY_HELP_STATE,
  beginHelpNavigation,
  completeHelpNavigation,
  failHelpNavigation,
  popHelpHistory,
  closeHelp,
} from '../../src/renderer/editor/helpDoc'

describe('parseDocCommand', () => {
  it('extracts the identifier from a doc call', () => {
    expect(parseDocCommand('doc sin')).toBe('sin')
    expect(parseDocCommand('  doc  plot  ')).toBe('plot')
    expect(parseDocCommand('doc foo_bar')).toBe('foo_bar')
    expect(parseDocCommand('doc matrix.times')).toBe('matrix.times')
    expect(parseDocCommand('doc sin;')).toBe('sin')
  })

  it('returns null when the shape does not match', () => {
    expect(parseDocCommand('doc')).toBeNull()
    expect(parseDocCommand('')).toBeNull()
    expect(parseDocCommand('sin')).toBeNull()
    expect(parseDocCommand('doc sin cos')).toBeNull()
    expect(parseDocCommand('doc()')).toBeNull()
    expect(parseDocCommand('doc 1abc')).toBeNull()
    expect(parseDocCommand('docs sin')).toBeNull()
  })
})

describe('parseHelpCommand', () => {
  it('mirrors parseDocCommand for the help keyword', () => {
    expect(parseHelpCommand('help sin')).toBe('sin')
    expect(parseHelpCommand('help')).toBeNull()
    expect(parseHelpCommand('help sin cos')).toBeNull()
  })
})

describe('buildHelpFetchCommand + extractHelpBody', () => {
  it('wraps the body in marker delimiters', () => {
    const cmd = buildHelpFetchCommand('sin')
    // Uses evalc('help <name>') (the command form) because the
    // `help()` function form returns an empty string when Octave's
    // texinfo filter fails, and falls back to get_help_text.
    expect(cmd).toContain("evalc('help sin')")
    expect(cmd).toContain("get_help_text('sin')")
    expect(cmd).toContain('__MSLP_HELP_BEGIN__:sin')
    expect(cmd).toContain('__MSLP_HELP_END__')
  })

  it('strips unsafe characters from the name before interpolation', () => {
    const cmd = buildHelpFetchCommand("sin'); system('rm -rf /")
    expect(cmd).not.toContain("system('rm")
    expect(cmd).toContain("evalc('help sinsystemrmrf')")
  })

  it('slices the body out of noisy output', () => {
    const raw = [
      '>> doc sin',
      '__MSLP_HELP_BEGIN__:sin',
      ' -- Mapping Function: Y = sin (X)',
      '     Compute the sine of X.',
      '',
      '    See also: cos, tan.',
      '__MSLP_HELP_END__',
      'some trailing prompt',
    ].join('\n')
    const body = extractHelpBody(raw)
    expect(body).not.toBeNull()
    expect(body).toContain('Compute the sine of X.')
    expect(body).toContain('See also: cos, tan.')
  })

  it('returns null when markers are missing', () => {
    expect(extractHelpBody('no markers here')).toBeNull()
  })

  it('extracts a real Octave `help sin` output captured via evalc', () => {
    // Captured from a real Octave 8.4 install where the texinfo filter
    // raises a warning and Octave falls back to printing the raw
    // texinfo-ish blob. The panel must still render this — the prior
    // implementation used `disp(help('sin'))` which returns '' in this
    // case and produced a spurious "No help found" error.
    const fixture = [
      '__MSLP_HELP_BEGIN__:sin',
      "warning: help: Texinfo formatting filter exited abnormally; raw Texinfo source of help text follows...",
      "'sin' is a built-in function from the file libinterp/corefcn/mappers.cc",
      '',
      '',
      'Additional help for built-in functions and operators is',
      "available in the online version of the manual.  Use the command",
      "'doc <topic>' to search the manual index.",
      '',
      '__MSLP_HELP_END__',
    ].join('\n')
    const body = extractHelpBody(fixture)
    expect(body).not.toBeNull()
    expect(body).toContain("'sin' is a built-in function")
    // The panel must render this body as content (not as 'No help found').
    const segs = splitHelpBody(body!)
    const joined = segs
      .map((s) => (s.kind === 'text' ? s.text : s.target))
      .join('')
    expect(joined).toContain("'sin' is a built-in function")
  })

  it('extracts a Octave `help foo` error body (error: ... verbatim)', () => {
    const fixture = [
      '__MSLP_HELP_BEGIN__:nonexistentfunc',
      "error: help: 'nonexistentfunc' not found",
      '__MSLP_HELP_END__',
    ].join('\n')
    const body = extractHelpBody(fixture)
    expect(body).toBe("error: help: 'nonexistentfunc' not found")
  })
})

describe('extractSeeAlso', () => {
  it('finds tokens in a comma-separated list', () => {
    expect(extractSeeAlso('help text\nSee also: cos, tan.')).toEqual(['cos', 'tan'])
  })

  it('is case-insensitive and handles multi-line blocks', () => {
    const body = 'prose\n   see also: cos, tan,\n              atan2, sinh.'
    expect(extractSeeAlso(body)).toEqual(['cos', 'tan', 'atan2', 'sinh'])
  })

  it('stops at blank line', () => {
    const body = 'See also: cos, tan\n\nMore paragraphs mentioning xyz.'
    expect(extractSeeAlso(body)).toEqual(['cos', 'tan'])
  })

  it('handles @xref texinfo form', () => {
    const body = 'See @xref{cos}, @xref{tan} for more details.'
    expect(extractSeeAlso(body)).toEqual(['cos', 'tan'])
  })

  it('dedupes while preserving order', () => {
    expect(extractSeeAlso('See also: cos, tan, cos.')).toEqual(['cos', 'tan'])
  })

  it('returns [] when there is no see-also section', () => {
    expect(extractSeeAlso('just some help text')).toEqual([])
    expect(extractSeeAlso('')).toEqual([])
  })
})

describe('splitHelpBody', () => {
  it('returns a single text segment when there are no cross-refs', () => {
    const segs = splitHelpBody('plain help text')
    expect(segs).toEqual([{ kind: 'text', text: 'plain help text' }])
  })

  it('promotes cross-ref identifiers after "See also:" into link segments', () => {
    const body = 'A useful function.\n\nSee also: cos, tan.'
    const segs = splitHelpBody(body)
    const links = segs.filter((s) => s.kind === 'link').map((s) => (s as { target: string }).target)
    expect(links).toEqual(['cos', 'tan'])
    // The text prefix is preserved as a single text segment.
    expect(segs[0]).toEqual({ kind: 'text', text: 'A useful function.\n\nSee also:' })
  })

  it('does not linkify identifier mentions BEFORE the see-also section', () => {
    const body = 'sin is the sine function.\nSee also: cos.'
    const segs = splitHelpBody(body)
    // "sin" should stay as text — it appears in the head, not in the tail.
    const head = segs[0]
    expect(head.kind).toBe('text')
    expect((head as { text: string }).text).toContain('sin is the sine function.')
  })
})

describe('HelpState reducer helpers', () => {
  it('beginHelpNavigation stashes previous topic on the history stack', () => {
    const s1 = beginHelpNavigation(EMPTY_HELP_STATE, 'sin')
    expect(s1.topic).toBe('sin')
    expect(s1.loading).toBe(true)
    expect(s1.history).toEqual([])

    const s2 = beginHelpNavigation(s1, 'cos')
    expect(s2.topic).toBe('cos')
    expect(s2.history).toEqual(['sin'])
  })

  it('beginHelpNavigation does not stack when navigating to the same topic', () => {
    const s1 = beginHelpNavigation(EMPTY_HELP_STATE, 'sin')
    const s2 = beginHelpNavigation(s1, 'sin')
    expect(s2.history).toEqual([])
  })

  it('completeHelpNavigation applies content only for matching topic', () => {
    const s1 = beginHelpNavigation(EMPTY_HELP_STATE, 'sin')
    const s2 = completeHelpNavigation(s1, 'sin', 'body text')
    expect(s2.content).toBe('body text')
    expect(s2.loading).toBe(false)

    // Stale result for a previous topic is ignored.
    const stale = completeHelpNavigation(s2, 'cos', 'other')
    expect(stale).toBe(s2)
  })

  it('failHelpNavigation records error message', () => {
    const s1 = beginHelpNavigation(EMPTY_HELP_STATE, 'sin')
    const s2 = failHelpNavigation(s1, 'sin', 'boom')
    expect(s2.error).toBe('boom')
    expect(s2.loading).toBe(false)
  })

  it('popHelpHistory walks the stack backward', () => {
    let s = beginHelpNavigation(EMPTY_HELP_STATE, 'sin')
    s = completeHelpNavigation(s, 'sin', 'sin body')
    s = beginHelpNavigation(s, 'cos')
    s = completeHelpNavigation(s, 'cos', 'cos body')
    const { state: popped, previous } = popHelpHistory(s)
    expect(previous).toBe('sin')
    expect(popped.topic).toBe('sin')
    expect(popped.history).toEqual([])
    expect(popped.loading).toBe(true)
  })

  it('popHelpHistory is a no-op on empty history', () => {
    const s1 = beginHelpNavigation(EMPTY_HELP_STATE, 'sin')
    const { state: popped, previous } = popHelpHistory(s1)
    expect(previous).toBeNull()
    expect(popped).toBe(s1)
  })

  it('closeHelp resets to the empty state', () => {
    const s1 = beginHelpNavigation(EMPTY_HELP_STATE, 'sin')
    expect(closeHelp(s1)).toEqual(EMPTY_HELP_STATE)
  })
})
