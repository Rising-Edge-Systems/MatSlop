export interface EditorTab {
  id: string
  filename: string
  content: string
  savedContent: string
  filePath: string | null
}

let nextId = 1

export function createTab(
  filename: string = 'untitled.m',
  content: string = '',
  filePath: string | null = null
): EditorTab {
  return {
    id: `tab-${nextId++}`,
    filename,
    content,
    savedContent: content,
    filePath,
  }
}
