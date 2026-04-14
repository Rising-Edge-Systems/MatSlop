// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useScriptExecution } from '../../src/renderer/editor/useScriptExecution'
import type { EditorTab } from '../../src/renderer/editor/editorTypes'

// ── Mock functionFileDetection module ─────────────────────────────────────
vi.mock('../../src/renderer/editor/functionFileDetection', () => ({
  isFunctionOnlyFile: vi.fn().mockReturnValue(false),
  buildRunScriptCommand: vi.fn().mockReturnValue({ command: 'source("test.m")' }),
}))

// ── Mock editorTypes section functions ────────────────────────────────────
vi.mock('../../src/renderer/editor/editorTypes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/editor/editorTypes')>()
  return {
    ...actual,
    findSectionRange: vi.fn().mockReturnValue({
      headerLine: null,
      contentStartLine: 1,
      endLine: 3,
      code: 'x = 1;\ny = 2;',
    }),
    findNextSectionAdvanceLine: vi.fn().mockReturnValue(5),
  }
})

import { isFunctionOnlyFile, buildRunScriptCommand } from '../../src/renderer/editor/functionFileDetection'
import { findSectionRange, findNextSectionAdvanceLine } from '../../src/renderer/editor/editorTypes'

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<EditorTab> & { id: string }): EditorTab {
  return {
    filename: 'test.m',
    content: 'x = 1;',
    savedContent: 'x = 1;',
    filePath: '/home/user/test.m',
    mode: 'script',
    ...overrides,
  }
}

function makeMockEditor() {
  return {
    getPosition: vi.fn().mockReturnValue({ lineNumber: 2, column: 1 }),
    setPosition: vi.fn(),
    revealLineInCenterIfOutsideViewport: vi.fn(),
    focus: vi.fn(),
  } as unknown as ReturnType<typeof vi.fn> & {
    getPosition: ReturnType<typeof vi.fn>
    setPosition: ReturnType<typeof vi.fn>
    revealLineInCenterIfOutsideViewport: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('useScriptExecution', () => {
  let dispatch: ReturnType<typeof vi.fn>
  let saveFile: ReturnType<typeof vi.fn>
  let onRun: ReturnType<typeof vi.fn>
  let onStop: ReturnType<typeof vi.fn>
  let onRunSection: ReturnType<typeof vi.fn>
  let activeTab: EditorTab | null
  let mockEditor: ReturnType<typeof makeMockEditor>
  let mockMatslop: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    vi.clearAllMocks()

    // Re-setup module mock return values after clearAllMocks
    vi.mocked(isFunctionOnlyFile).mockReturnValue(false)
    vi.mocked(buildRunScriptCommand).mockReturnValue({ command: 'source("test.m")' } as never)
    vi.mocked(findSectionRange).mockReturnValue({
      headerLine: null,
      contentStartLine: 1,
      endLine: 3,
      code: 'x = 1;\ny = 2;',
    })
    vi.mocked(findNextSectionAdvanceLine).mockReturnValue(5)

    dispatch = vi.fn()
    saveFile = vi.fn().mockResolvedValue(true)
    onRun = vi.fn()
    onStop = vi.fn()
    onRunSection = vi.fn()
    activeTab = makeTab({ id: 'tab-1' })
    mockEditor = makeMockEditor()

    mockMatslop = {
      saveFile: vi.fn().mockResolvedValue({ success: true }),
      saveFileAs: vi.fn().mockResolvedValue(null),
      getHomeDir: vi.fn().mockResolvedValue('/home/user'),
      octaveExecute: vi.fn().mockResolvedValue({ output: '', error: '' }),
      octaveSendRaw: vi.fn().mockResolvedValue({ output: '', error: '' }),
      debugReapplyBreakpointsForFile: vi.fn().mockResolvedValue(undefined),
    }
    ;(window as unknown as { matslop: typeof mockMatslop }).matslop = mockMatslop
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderExecution(overrides: Record<string, unknown> = {}) {
    return renderHook(() =>
      useScriptExecution({
        getActiveTab: () => activeTab,
        saveFile,
        dispatch,
        onRun,
        onStop,
        onRunSection,
        getEditorInstance: () => mockEditor as never,
        isPaused: false,
        ...overrides,
      }),
    )
  }

  // ── run() ─────────────────────────────────────────────────────────────

  describe('run()', () => {
    it('auto-saves via window.matslop.saveFile before executing', async () => {
      const { result } = renderExecution()
      await act(async () => {
        await result.current.run()
      })

      expect(mockMatslop.saveFile).toHaveBeenCalledWith('/home/user/test.m', 'x = 1;')
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_SAVED_CONTENT',
        payload: { tabId: 'tab-1', savedContent: 'x = 1;' },
      })
    })

    it('builds command with buildRunScriptCommand and calls octaveExecute for a saved file', async () => {
      const { result } = renderExecution()
      await act(async () => {
        await result.current.run()
      })

      expect(buildRunScriptCommand).toHaveBeenCalledWith(
        '/home/user/test.m',
        '/home/user',
      )
      expect(mockMatslop.octaveExecute).toHaveBeenCalledWith('source("test.m")')
    })

    it('writes to a temp file and runs from there for an untitled file', async () => {
      activeTab = makeTab({ id: 'tab-1', filePath: null, filename: 'untitled.m', content: 'y = 2;' })

      const { result } = renderExecution()
      await act(async () => {
        await result.current.run()
      })

      expect(mockMatslop.getHomeDir).toHaveBeenCalled()
      expect(mockMatslop.saveFile).toHaveBeenCalledWith(
        '/home/user/matslop_run_tab_1.m',
        'y = 2;',
      )
      expect(buildRunScriptCommand).toHaveBeenCalledWith(
        '/home/user/matslop_run_tab_1.m',
        '/home/user',
      )
    })

    it('sets runWarning and does NOT execute for a function-only file', async () => {
      vi.mocked(isFunctionOnlyFile).mockReturnValue(true)

      const { result } = renderExecution()
      await act(async () => {
        await result.current.run()
      })

      expect(result.current.runWarning).toBe('This file only defines function(s); nothing to run.')
      expect(mockMatslop.octaveExecute).not.toHaveBeenCalled()
      expect(mockMatslop.saveFile).not.toHaveBeenCalled()
    })

    it('does nothing when there is no active tab', async () => {
      activeTab = null

      const { result } = renderExecution()
      await act(async () => {
        await result.current.run()
      })

      expect(mockMatslop.saveFile).not.toHaveBeenCalled()
      expect(mockMatslop.octaveExecute).not.toHaveBeenCalled()
    })

    it('sends dbcont when paused at a breakpoint instead of re-running', async () => {
      const { result } = renderExecution({ isPaused: true })
      await act(async () => {
        await result.current.run()
      })

      expect(mockMatslop.octaveSendRaw).toHaveBeenCalledWith('dbcont')
      expect(mockMatslop.saveFile).not.toHaveBeenCalled()
    })
  })

  // ── runSection() ──────────────────────────────────────────────────────

  describe('runSection()', () => {
    it('extracts code at cursor line using findSectionRange and calls onRunSection', () => {
      const { result } = renderExecution()
      act(() => {
        result.current.runSection()
      })

      expect(findSectionRange).toHaveBeenCalledWith('x = 1;', 2)
      expect(onRunSection).toHaveBeenCalledWith('x = 1;\ny = 2;')
    })

    it('does nothing when there is no active tab', () => {
      activeTab = null

      const { result } = renderExecution()
      act(() => {
        result.current.runSection()
      })

      expect(findSectionRange).not.toHaveBeenCalled()
      expect(onRunSection).not.toHaveBeenCalled()
    })

    it('does nothing when the section code is empty', () => {
      vi.mocked(findSectionRange).mockReturnValue({
        headerLine: null,
        contentStartLine: 1,
        endLine: 1,
        code: '   ',
      })

      const { result } = renderExecution()
      act(() => {
        result.current.runSection()
      })

      expect(onRunSection).not.toHaveBeenCalled()
    })
  })

  // ── runAndAdvance() ───────────────────────────────────────────────────

  describe('runAndAdvance()', () => {
    it('runs section and advances cursor to next section line', () => {
      const { result } = renderExecution()
      act(() => {
        result.current.runAndAdvance()
      })

      expect(onRunSection).toHaveBeenCalledWith('x = 1;\ny = 2;')
      expect(findNextSectionAdvanceLine).toHaveBeenCalledWith('x = 1;', 2)
      expect((mockEditor as unknown as { setPosition: ReturnType<typeof vi.fn> }).setPosition).toHaveBeenCalledWith({ lineNumber: 5, column: 1 })
      expect((mockEditor as unknown as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalled()
    })
  })

  // ── stop() ────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('calls onStop callback', () => {
      const { result } = renderExecution()
      act(() => {
        result.current.stop()
      })

      expect(onStop).toHaveBeenCalled()
    })
  })

  // ── clearRunWarning() ─────────────────────────────────────────────────

  describe('clearRunWarning()', () => {
    it('clears the run warning', async () => {
      vi.mocked(isFunctionOnlyFile).mockReturnValue(true)

      const { result } = renderExecution()
      await act(async () => {
        await result.current.run()
      })
      expect(result.current.runWarning).toBe('This file only defines function(s); nothing to run.')

      act(() => {
        result.current.clearRunWarning()
      })
      expect(result.current.runWarning).toBeNull()
    })
  })
})
