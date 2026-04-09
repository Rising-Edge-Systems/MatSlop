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
    // Octave configuration
    octaveAutoDetect: () => Promise<string | null>
    octaveValidate: (binaryPath: string) => Promise<{ valid: boolean; version?: string; error?: string }>
    octaveGetPath: () => Promise<string | null>
    octaveSetPath: (binaryPath: string) => Promise<void>
    octaveBrowse: () => Promise<string | null>
    // Octave process management
    octaveStart: (binaryPath: string) => Promise<{ success: boolean; error?: string }>
    octaveExecute: (command: string) => Promise<{ output: string; error: string; isComplete: boolean }>
    octaveInterrupt: () => Promise<void>
    octaveRestart: (binaryPath: string) => Promise<{ success: boolean }>
    octaveGetStatus: () => Promise<'ready' | 'busy' | 'disconnected'>
    onOctaveStatusChanged: (callback: (status: 'ready' | 'busy' | 'disconnected') => void) => () => void
    onOctaveCrashed: (callback: (info: { code: number | null; signal: string | null; error?: string }) => void) => () => void
  }
}
