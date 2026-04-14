// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDragDrop, type DroppedFile } from '../../src/renderer/editor/useDragDrop'

// Helper to create a mock DragEvent
function makeDragEvent(
  type: string,
  options: {
    files?: Array<{ name: string; path: string }>
    types?: string[]
  } = {}
): React.DragEvent<HTMLDivElement> {
  const { files = [], types = ['Files'] } = options

  const fileList = files.map((f) => {
    const file = new File([''], f.name) as File & { path: string }
    Object.defineProperty(file, 'path', { value: f.path, writable: false })
    return file
  })

  // Build a mock FileList-like object
  const mockFileList = {
    length: fileList.length,
    item: (i: number) => fileList[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of fileList) yield f
    },
  } as unknown as FileList

  // Assign indexed properties
  for (let i = 0; i < fileList.length; i++) {
    ;(mockFileList as any)[i] = fileList[i]
  }

  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files: mockFileList,
      types,
    },
    type,
  } as unknown as React.DragEvent<HTMLDivElement>
}

describe('useDragDrop', () => {
  let onFilesDropped: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onFilesDropped = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('isDragOver becomes true on dragEnter and false on dragLeave', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    expect(result.current.isDragOver).toBe(false)

    act(() => {
      result.current.dragHandlers.onDragEnter(makeDragEvent('dragenter'))
    })
    expect(result.current.isDragOver).toBe(true)

    act(() => {
      result.current.dragHandlers.onDragLeave(makeDragEvent('dragleave'))
    })
    expect(result.current.isDragOver).toBe(false)
  })

  it('nested dragEnter/dragLeave events do not flicker isDragOver (counter pattern)', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    // Outer element dragEnter
    act(() => {
      result.current.dragHandlers.onDragEnter(makeDragEvent('dragenter'))
    })
    expect(result.current.isDragOver).toBe(true)

    // Nested child element dragEnter
    act(() => {
      result.current.dragHandlers.onDragEnter(makeDragEvent('dragenter'))
    })
    expect(result.current.isDragOver).toBe(true)

    // Nested child element dragLeave (counter goes from 2 to 1 — still over)
    act(() => {
      result.current.dragHandlers.onDragLeave(makeDragEvent('dragleave'))
    })
    expect(result.current.isDragOver).toBe(true)

    // Outer element dragLeave (counter goes to 0 — no longer over)
    act(() => {
      result.current.dragHandlers.onDragLeave(makeDragEvent('dragleave'))
    })
    expect(result.current.isDragOver).toBe(false)
  })

  it('onDrop with .m files calls onFilesDropped with correct paths', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    // Enter first so isDragOver is true
    act(() => {
      result.current.dragHandlers.onDragEnter(makeDragEvent('dragenter'))
    })

    act(() => {
      result.current.dragHandlers.onDrop(
        makeDragEvent('drop', {
          files: [
            { name: 'script.m', path: '/home/user/script.m' },
            { name: 'other.m', path: '/home/user/other.m' },
          ],
        })
      )
    })

    expect(onFilesDropped).toHaveBeenCalledWith([
      { path: '/home/user/script.m', name: 'script.m' },
      { path: '/home/user/other.m', name: 'other.m' },
    ] satisfies DroppedFile[])
  })

  it('onDrop with .mls files calls onFilesDropped with correct paths', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    act(() => {
      result.current.dragHandlers.onDrop(
        makeDragEvent('drop', {
          files: [{ name: 'notebook.mls', path: '/home/user/notebook.mls' }],
        })
      )
    })

    expect(onFilesDropped).toHaveBeenCalledWith([
      { path: '/home/user/notebook.mls', name: 'notebook.mls' },
    ])
  })

  it('onDrop with non-.m/.mls files does not call onFilesDropped', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    act(() => {
      result.current.dragHandlers.onDrop(
        makeDragEvent('drop', {
          files: [
            { name: 'readme.txt', path: '/home/user/readme.txt' },
            { name: 'image.png', path: '/home/user/image.png' },
          ],
        })
      )
    })

    expect(onFilesDropped).not.toHaveBeenCalled()
  })

  it('onDrop with mixed valid and invalid files only passes valid files', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    act(() => {
      result.current.dragHandlers.onDrop(
        makeDragEvent('drop', {
          files: [
            { name: 'script.m', path: '/home/user/script.m' },
            { name: 'readme.txt', path: '/home/user/readme.txt' },
            { name: 'notebook.mls', path: '/home/user/notebook.mls' },
          ],
        })
      )
    })

    expect(onFilesDropped).toHaveBeenCalledWith([
      { path: '/home/user/script.m', name: 'script.m' },
      { path: '/home/user/notebook.mls', name: 'notebook.mls' },
    ])
  })

  it('isDragOver resets to false after drop', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    // Enter to set isDragOver true
    act(() => {
      result.current.dragHandlers.onDragEnter(makeDragEvent('dragenter'))
    })
    expect(result.current.isDragOver).toBe(true)

    // Drop resets it
    act(() => {
      result.current.dragHandlers.onDrop(
        makeDragEvent('drop', {
          files: [{ name: 'script.m', path: '/home/user/script.m' }],
        })
      )
    })
    expect(result.current.isDragOver).toBe(false)
  })

  it('dragEnter with non-Files types does not set isDragOver', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    act(() => {
      result.current.dragHandlers.onDragEnter(
        makeDragEvent('dragenter', { types: ['text/plain'] })
      )
    })
    expect(result.current.isDragOver).toBe(false)
  })

  it('onDragOver prevents default to allow drop', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    const event = makeDragEvent('dragover')
    act(() => {
      result.current.dragHandlers.onDragOver(event)
    })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('onDrop with files missing path property skips them', () => {
    const { result } = renderHook(() => useDragDrop({ onFilesDropped }))

    // Create a file without .path (non-Electron environment)
    const fileWithoutPath = new File([''], 'script.m')
    const mockFileList = {
      length: 1,
      item: (i: number) => (i === 0 ? fileWithoutPath : null),
      0: fileWithoutPath,
      [Symbol.iterator]: function* () {
        yield fileWithoutPath
      },
    } as unknown as FileList

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: mockFileList, types: ['Files'] },
      type: 'drop',
    } as unknown as React.DragEvent<HTMLDivElement>

    act(() => {
      result.current.dragHandlers.onDrop(event)
    })

    expect(onFilesDropped).not.toHaveBeenCalled()
  })
})
