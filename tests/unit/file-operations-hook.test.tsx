// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useFileOperations } from '../../src/renderer/editor/useFileOperations'
import type { EditorTab } from '../../src/renderer/editor/editorTypes'

// ── Mock publishHtml module ────────────────────────────────────────────────
vi.mock('../../src/renderer/editor/publishHtml', () => ({
  publishHtml: vi.fn().mockReturnValue('<html>published</html>'),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<EditorTab> & { id: string }): EditorTab {
  return {
    filename: 'untitled.m',
    content: '',
    savedContent: '',
    filePath: null,
    mode: 'script',
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useFileOperations', () => {
  let dispatch: ReturnType<typeof vi.fn>
  let tabs: EditorTab[]
  let mockMatslop: {
    openFile: ReturnType<typeof vi.fn>
    saveFile: ReturnType<typeof vi.fn>
    saveFileAs: ReturnType<typeof vi.fn>
    recentFilesAdd: ReturnType<typeof vi.fn>
    publishSaveDialog: ReturnType<typeof vi.fn>
    publishWriteFile: ReturnType<typeof vi.fn>
    octaveExecute: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    dispatch = vi.fn()
    tabs = []

    mockMatslop = {
      openFile: vi.fn().mockResolvedValue(null),
      saveFile: vi.fn().mockResolvedValue({ success: true }),
      saveFileAs: vi.fn().mockResolvedValue(null),
      recentFilesAdd: vi.fn(),
      publishSaveDialog: vi.fn().mockResolvedValue(null),
      publishWriteFile: vi.fn().mockResolvedValue(undefined),
      octaveExecute: vi.fn().mockResolvedValue({ output: '', error: '' }),
    }
    ;(window as unknown as { matslop: typeof mockMatslop }).matslop = mockMatslop
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderFileOps() {
    return renderHook(() =>
      useFileOperations({ dispatch, getTabs: () => tabs }),
    )
  }

  // ── openFile ───────────────────────────────────────────────────────────

  describe('openFile', () => {
    it('dispatches CREATE_TAB with correct filename, content, filePath, and mode for a new .m file', async () => {
      mockMatslop.openFile.mockResolvedValue({
        filename: 'test.m',
        content: 'x = 1;',
        filePath: '/home/user/test.m',
      })

      const { result } = renderFileOps()
      await act(async () => {
        await result.current.openFile()
      })

      expect(dispatch).toHaveBeenCalledWith({
        type: 'CREATE_TAB',
        payload: {
          filename: 'test.m',
          content: 'x = 1;',
          filePath: '/home/user/test.m',
          mode: 'script',
        },
      })
      expect(mockMatslop.recentFilesAdd).toHaveBeenCalledWith('/home/user/test.m')
    })

    it('dispatches CREATE_TAB with mode "livescript" for .mls files', async () => {
      mockMatslop.openFile.mockResolvedValue({
        filename: 'notebook.mls',
        content: '{"cells":[]}',
        filePath: '/home/user/notebook.mls',
      })

      const { result } = renderFileOps()
      await act(async () => {
        await result.current.openFile()
      })

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CREATE_TAB',
          payload: expect.objectContaining({ mode: 'livescript' }),
        }),
      )
    })

    it('dispatches SELECT_TAB for an already-open file (no duplicate tab)', async () => {
      const existingTab = makeTab({
        id: 'tab-1',
        filename: 'test.m',
        filePath: '/home/user/test.m',
      })
      tabs = [existingTab]

      mockMatslop.openFile.mockResolvedValue({
        filename: 'test.m',
        content: 'x = 1;',
        filePath: '/home/user/test.m',
      })

      const { result } = renderFileOps()
      await act(async () => {
        await result.current.openFile()
      })

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SELECT_TAB',
        payload: { tabId: 'tab-1' },
      })
      // Should NOT create a new tab
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CREATE_TAB' }),
      )
      expect(mockMatslop.recentFilesAdd).toHaveBeenCalledWith('/home/user/test.m')
    })

    it('does nothing when user cancels the dialog', async () => {
      mockMatslop.openFile.mockResolvedValue(null)

      const { result } = renderFileOps()
      await act(async () => {
        await result.current.openFile()
      })

      expect(dispatch).not.toHaveBeenCalled()
      expect(mockMatslop.recentFilesAdd).not.toHaveBeenCalled()
    })
  })

  // ── saveFile ───────────────────────────────────────────────────────────

  describe('saveFile', () => {
    it('calls window.matslop.saveFile and dispatches UPDATE_SAVED_CONTENT for a tab with filePath', async () => {
      const tab = makeTab({
        id: 'tab-1',
        filename: 'test.m',
        content: 'x = 42;',
        filePath: '/home/user/test.m',
      })

      const { result } = renderFileOps()
      let success: boolean | undefined
      await act(async () => {
        success = await result.current.saveFile(tab)
      })

      expect(mockMatslop.saveFile).toHaveBeenCalledWith('/home/user/test.m', 'x = 42;')
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_SAVED_CONTENT',
        payload: { tabId: 'tab-1', savedContent: 'x = 42;' },
      })
      expect(success).toBe(true)
    })

    it('does not dispatch UPDATE_SAVED_CONTENT when save fails', async () => {
      mockMatslop.saveFile.mockResolvedValue({ success: false })
      const tab = makeTab({
        id: 'tab-1',
        filePath: '/home/user/test.m',
        content: 'x = 1;',
      })

      const { result } = renderFileOps()
      let success: boolean | undefined
      await act(async () => {
        success = await result.current.saveFile(tab)
      })

      expect(dispatch).not.toHaveBeenCalled()
      expect(success).toBe(false)
    })

    it('delegates to saveFileAs for an untitled tab (no filePath)', async () => {
      mockMatslop.saveFileAs.mockResolvedValue({
        filename: 'saved.m',
        filePath: '/home/user/saved.m',
      })

      const tab = makeTab({
        id: 'tab-1',
        filename: 'untitled.m',
        content: 'y = 2;',
        filePath: null,
      })

      const { result } = renderFileOps()
      await act(async () => {
        await result.current.saveFile(tab)
      })

      // Should call saveFileAs, not saveFile
      expect(mockMatslop.saveFile).not.toHaveBeenCalled()
      expect(mockMatslop.saveFileAs).toHaveBeenCalledWith('y = 2;', 'untitled.m')
      expect(dispatch).toHaveBeenCalledWith({
        type: 'RENAME_TAB',
        payload: {
          tabId: 'tab-1',
          filename: 'saved.m',
          filePath: '/home/user/saved.m',
        },
      })
    })
  })

  // ── saveFileAs ─────────────────────────────────────────────────────────

  describe('saveFileAs', () => {
    it('dispatches RENAME_TAB and UPDATE_SAVED_CONTENT on success', async () => {
      mockMatslop.saveFileAs.mockResolvedValue({
        filename: 'newname.m',
        filePath: '/home/user/newname.m',
      })

      const tab = makeTab({
        id: 'tab-2',
        content: 'z = 3;',
        filename: 'untitled.m',
      })

      const { result } = renderFileOps()
      let success: boolean | undefined
      await act(async () => {
        success = await result.current.saveFileAs(tab)
      })

      expect(mockMatslop.saveFileAs).toHaveBeenCalledWith('z = 3;', 'untitled.m')
      expect(dispatch).toHaveBeenCalledWith({
        type: 'RENAME_TAB',
        payload: {
          tabId: 'tab-2',
          filename: 'newname.m',
          filePath: '/home/user/newname.m',
        },
      })
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_SAVED_CONTENT',
        payload: { tabId: 'tab-2', savedContent: 'z = 3;' },
      })
      expect(success).toBe(true)
    })

    it('does nothing when user cancels', async () => {
      mockMatslop.saveFileAs.mockResolvedValue(null)

      const tab = makeTab({ id: 'tab-2', content: 'z = 3;' })

      const { result } = renderFileOps()
      let success: boolean | undefined
      await act(async () => {
        success = await result.current.saveFileAs(tab)
      })

      expect(dispatch).not.toHaveBeenCalled()
      expect(success).toBe(false)
    })
  })
})
