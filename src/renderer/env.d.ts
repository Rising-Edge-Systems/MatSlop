/// <reference types="vite/client" />

interface Window {
  matslop: {
    platform: string
    openFile: () => Promise<{ filePath: string; content: string; filename: string } | null>
    saveFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
    saveFileAs: (content: string, defaultName?: string) => Promise<{ filePath: string; filename: string } | null>
    confirmClose: (filename: string) => Promise<number>
  }
}
