import { describe, it, expect } from 'vitest'
import {
  isFunctionOnlyFile,
  buildRunScriptCommand,
} from '../../src/renderer/editor/functionFileDetection'

/**
 * US-S05: isFunctionOnlyFile is the heuristic that powers the editor Run
 * button's "nothing to run" banner. Octave's rule: a file is a function
 * file iff its first non-blank, non-comment statement is the `function`
 * keyword. Everything that isn't a function file is a script and will
 * have top-level code for `source(...)` to execute.
 */
describe('isFunctionOnlyFile', () => {
  describe('function files (no top-level code)', () => {
    it('detects a plain function definition as function-only', () => {
      const src = 'function y = sq(x)\n  y = x * x;\nend\n'
      expect(isFunctionOnlyFile(src)).toBe(true)
    })

    it('detects a function file prefixed with a comment block', () => {
      const src = [
        '% helper — square a number',
        '% usage: y = sq(x)',
        '',
        'function y = sq(x)',
        '  y = x * x;',
        'end',
      ].join('\n')
      expect(isFunctionOnlyFile(src)).toBe(true)
    })

    it('treats # shell-style comments above function as non-code', () => {
      const src = '# legacy comment style\nfunction y = f()\n  y = 1;\nend\n'
      expect(isFunctionOnlyFile(src)).toBe(true)
    })

    it('skips %{ ... %} block comments before the function', () => {
      const src = [
        '%{',
        'This is a block comment',
        'describing the function',
        '%}',
        'function y = g()',
        '  y = 2;',
        'end',
      ].join('\n')
      expect(isFunctionOnlyFile(src)).toBe(true)
    })

    it('detects function keyword with leading whitespace', () => {
      expect(isFunctionOnlyFile('    function y = f()\n  y = 1;\nend\n')).toBe(true)
    })

    it('detects a file with multiple function definitions', () => {
      const src = [
        'function y = main(x)',
        '  y = helper(x) + 1;',
        'end',
        '',
        'function z = helper(x)',
        '  z = x * 2;',
        'end',
      ].join('\n')
      expect(isFunctionOnlyFile(src)).toBe(true)
    })

    it('treats an empty file as function-only (nothing to run)', () => {
      expect(isFunctionOnlyFile('')).toBe(true)
    })

    it('treats a comment-only file as function-only', () => {
      expect(isFunctionOnlyFile('% just notes\n% nothing to do here\n')).toBe(true)
    })

    it('treats whitespace-only file as function-only', () => {
      expect(isFunctionOnlyFile('   \n\n\t\n')).toBe(true)
    })
  })

  describe('script files (have top-level code)', () => {
    it('detects a plain script as runnable', () => {
      const src = 'x = 1;\ny = 2;\nz = x + y;\ndisp(z)\n'
      expect(isFunctionOnlyFile(src)).toBe(false)
    })

    it('detects a script that starts with disp()', () => {
      expect(isFunctionOnlyFile('disp("hello")\n')).toBe(false)
    })

    it('detects a script prefixed with comments', () => {
      const src = [
        '% demo script',
        '%',
        '% shows a simple calculation',
        '',
        'a = 10;',
        'b = 20;',
        'c = a + b',
      ].join('\n')
      expect(isFunctionOnlyFile(src)).toBe(false)
    })

    it('detects a script that also defines a subfunction AFTER top-level code', () => {
      const src = [
        'x = do_thing(5);',
        'disp(x)',
        '',
        'function y = do_thing(n)',
        '  y = n * 10;',
        'end',
      ].join('\n')
      expect(isFunctionOnlyFile(src)).toBe(false)
    })

    it('does not mistake `function_handle` for the function keyword', () => {
      // The `function` keyword requires a word boundary — `function_handle`
      // (identifier) should be treated as ordinary top-level code.
      expect(isFunctionOnlyFile('x = function_handle_foo;\n')).toBe(false)
    })

    it('does not mistake `functional` prefix for the function keyword', () => {
      expect(isFunctionOnlyFile('functional = 1;\n')).toBe(false)
    })

    it('handles CRLF line endings for script files', () => {
      expect(isFunctionOnlyFile('x = 1;\r\ny = 2;\r\n')).toBe(false)
    })

    it('handles CRLF line endings for function files', () => {
      expect(isFunctionOnlyFile('function y = f()\r\n  y = 1;\r\nend\r\n')).toBe(true)
    })
  })
})

/**
 * US-S05: buildRunScriptCommand is the pure command-string builder used
 * by the Run (F5) path for saved .m files. It MUST use `source(...)`
 * (so Octave surfaces top-level output in the Command Window) and cd
 * into the script's directory first so relative paths keep working.
 */
describe('buildRunScriptCommand', () => {
  it('builds source(<abs path>) with a leading cd for POSIX paths', () => {
    const { command, display } = buildRunScriptCommand(
      '/home/user/projects/demo/script.m',
      '/home/user/projects/demo'
    )
    expect(command).toBe(
      "cd('/home/user/projects/demo'); addpath('/home/user/projects/demo'); source('/home/user/projects/demo/script.m')"
    )
    // Display echoes the short filename only, not the full path.
    expect(display).toBe("script.m")
  })

  it('preserves Windows backslash paths verbatim inside single quotes', () => {
    const { command, display } = buildRunScriptCommand(
      'C:\\Users\\Ada\\demo\\run me.m',
      'C:\\Users\\Ada\\demo'
    )
    expect(command).toBe(
      "cd('C:\\Users\\Ada\\demo'); addpath('C:\\Users\\Ada\\demo'); source('C:\\Users\\Ada\\demo\\run me.m')"
    )
    expect(display).toBe("run me.m")
  })

  it("doubles embedded single quotes for Octave's string escaping", () => {
    const { command, display } = buildRunScriptCommand(
      "/tmp/ad's project/script.m",
      "/tmp/ad's project"
    )
    expect(command).toBe(
      "cd('/tmp/ad''s project'); addpath('/tmp/ad''s project'); source('/tmp/ad''s project/script.m')"
    )
    expect(display).toBe("script.m")
  })

  it('uses source() rather than run() — surfaces output in Command Window', () => {
    // Regression guard: the pre-S05 implementation called run(), which
    // does not pipe top-level output the same way. source() is the
    // contract the Command Window pipeline now depends on.
    const { command } = buildRunScriptCommand('/a/b.m', '/a')
    expect(command).toContain("source('/a/b.m')")
    expect(command).not.toMatch(/\brun\(/)
  })
})
