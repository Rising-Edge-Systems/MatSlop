export type EditorTabMode = 'script' | 'livescript'

export interface EditorTab {
  id: string
  filename: string
  content: string
  savedContent: string
  filePath: string | null
  mode: EditorTabMode
}

let nextId = 1

export function createTab(
  filename: string = 'untitled.m',
  content: string = '',
  filePath: string | null = null,
  mode: EditorTabMode = 'script'
): EditorTab {
  return {
    id: `tab-${nextId++}`,
    filename,
    content,
    savedContent: content,
    filePath,
    mode,
  }
}

export interface LiveScriptCell {
  type: 'code' | 'markdown'
  content: string
  output: string
}

export interface LiveScriptDocument {
  cells: LiveScriptCell[]
}

export function createEmptyLiveScript(): string {
  const doc: LiveScriptDocument = {
    cells: [
      { type: 'code', content: '% Write your MATLAB/Octave code here\n', output: '' },
    ],
  }
  return JSON.stringify(doc, null, 2)
}

export function parseLiveScript(content: string): LiveScriptDocument {
  try {
    const parsed = JSON.parse(content)
    if (parsed && Array.isArray(parsed.cells)) {
      return parsed as LiveScriptDocument
    }
  } catch {
    // ignore parse errors
  }
  return { cells: [{ type: 'code', content: '', output: '' }] }
}

export function serializeLiveScript(doc: LiveScriptDocument): string {
  return JSON.stringify(doc, null, 2)
}
