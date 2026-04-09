/// <reference types="vite/client" />

interface Window {
  matslop: {
    platform: string
    openFile: () => Promise<{ filePath: string; content: string; filename: string } | null>
    saveFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
    saveFileAs: (content: string, defaultName?: string) => Promise<{ filePath: string; filename: string } | null>
    confirmClose: (filename: string) => Promise<number>
    // Filesystem operations for File Browser
    readDir: (dirPath: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>
    readFile: (filePath: string) => Promise<{ filePath: string; content: string; filename: string } | null>
    selectDirectory: () => Promise<string | null>
    getHomeDir: () => Promise<string>
    fsRename: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
    fsDelete: (targetPath: string) => Promise<{ success: boolean; error?: string }>
    fsCreateFile: (dirPath: string, name: string) => Promise<{ success: boolean; path?: string; error?: string }>
    fsCreateFolder: (dirPath: string, name: string) => Promise<{ success: boolean; path?: string; error?: string }>
    confirmDelete: (name: string, isDirectory: boolean) => Promise<boolean>
  }
}
