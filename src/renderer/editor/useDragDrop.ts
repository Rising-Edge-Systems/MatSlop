import { useState, useRef, useCallback, type DragEvent } from 'react'

export interface DroppedFile {
  path: string
  name: string
}

export interface UseDragDropOptions {
  onFilesDropped: (files: DroppedFile[]) => void
}

export interface UseDragDropResult {
  isDragOver: boolean
  dragHandlers: {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => void
    onDragLeave: (e: DragEvent<HTMLDivElement>) => void
    onDragOver: (e: DragEvent<HTMLDivElement>) => void
    onDrop: (e: DragEvent<HTMLDivElement>) => void
  }
}

export function useDragDrop({ onFilesDropped }: UseDragDropOptions): UseDragDropResult {
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const onFilesDroppedRef = useRef(onFilesDropped)
  onFilesDroppedRef.current = onFilesDropped

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounterRef.current = 0

    const files = Array.from(e.dataTransfer.files)
    const validFiles: DroppedFile[] = []

    for (const file of files) {
      const filePath = (file as File & { path: string }).path
      if (!filePath) continue
      if (!filePath.endsWith('.m') && !filePath.endsWith('.mls')) continue
      validFiles.push({ path: filePath, name: file.name })
    }

    if (validFiles.length > 0) {
      onFilesDroppedRef.current(validFiles)
    }
  }, [])

  return {
    isDragOver,
    dragHandlers: { onDragEnter, onDragLeave, onDragOver, onDrop },
  }
}
