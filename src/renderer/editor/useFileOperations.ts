import { useCallback } from 'react'
import type { EditorTab } from './editorTypes'
import type { TabAction } from './useTabReducer'
import { publishHtml } from './publishHtml'

/**
 * Options accepted by the useFileOperations hook.
 *
 * `dispatch` – the dispatch function from useTabReducer.
 * `getTabs`  – a getter that returns the current tabs array so the hook
 *              can check for already-open files without re-creating
 *              callbacks on every render.
 */
interface UseFileOperationsOptions {
  dispatch: React.Dispatch<TabAction>
  getTabs: () => EditorTab[]
}

function detectMode(filename: string): 'livescript' | 'script' {
  return filename.endsWith('.mls') ? 'livescript' : 'script'
}

/**
 * Hook that encapsulates file open / save / save-as / publish-html logic.
 *
 * All file I/O is done through `window.matslop.*` IPC calls. Tab state
 * mutations are dispatched through the provided `dispatch` function so the
 * hook has no internal state of its own.
 */
export function useFileOperations({ dispatch, getTabs }: UseFileOperationsOptions) {
  const openFile = useCallback(async () => {
    const result = await window.matslop.openFile()
    if (!result) return

    // Check if the file is already open
    const existing = getTabs().find((t) => t.filePath === result.filePath)
    if (existing) {
      dispatch({ type: 'SELECT_TAB', payload: { tabId: existing.id } })
      window.matslop.recentFilesAdd(result.filePath)
      return
    }

    const mode = detectMode(result.filename)
    dispatch({
      type: 'CREATE_TAB',
      payload: {
        filename: result.filename,
        content: result.content,
        filePath: result.filePath,
        mode,
      },
    })
    window.matslop.recentFilesAdd(result.filePath)
  }, [dispatch, getTabs])

  const saveFile = useCallback(
    async (tab: EditorTab) => {
      if (tab.filePath) {
        const result = await window.matslop.saveFile(tab.filePath, tab.content)
        if (result.success) {
          dispatch({
            type: 'UPDATE_SAVED_CONTENT',
            payload: { tabId: tab.id, savedContent: tab.content },
          })
        }
        return result.success
      } else {
        // Untitled file — delegate to Save As
        return saveFileAs(tab)
      }
    },
    [dispatch],
  )

  const saveFileAs = useCallback(
    async (tab: EditorTab): Promise<boolean> => {
      const result = await window.matslop.saveFileAs(tab.content, tab.filename)
      if (!result) return false

      dispatch({
        type: 'RENAME_TAB',
        payload: {
          tabId: tab.id,
          filename: result.filename,
          filePath: result.filePath,
        },
      })
      dispatch({
        type: 'UPDATE_SAVED_CONTENT',
        payload: { tabId: tab.id, savedContent: tab.content },
      })
      return true
    },
    [dispatch],
  )

  const handlePublishHtml = useCallback(
    async (tab: EditorTab) => {
      if (!tab) return

      // For saved .m scripts, capture disp/fprintf output by sourcing
      // the file inside evalc(...) so the published HTML carries real
      // runtime output.
      let scriptOutput: string | undefined
      if (tab.mode !== 'livescript' && tab.filePath) {
        try {
          const escapedPath = tab.filePath.replace(/'/g, "''")
          const res = await window.matslop.octaveExecute(
            `disp(evalc("source('${escapedPath}')"))`,
          )
          const combined = (res?.output ?? '') + (res?.error ?? '')
          if (combined.trim().length > 0)
            scriptOutput = combined.replace(/\n+$/, '')
        } catch {
          /* swallow — publish without output */
        }
      }

      const html = publishHtml({
        filename: tab.filename,
        mode: tab.mode === 'livescript' ? 'livescript' : 'script',
        content: tab.content,
        scriptOutput,
        timestamp: new Date().toISOString(),
      })
      const defaultName =
        tab.filename.replace(/\.(m|mls)$/i, '') + '.html'
      const dialogResult = await window.matslop.publishSaveDialog(defaultName)
      if (!dialogResult) return
      await window.matslop.publishWriteFile(dialogResult.filePath, html)
    },
    [],
  )

  return {
    openFile,
    saveFile,
    saveFileAs,
    publishHtml: handlePublishHtml,
  }
}
