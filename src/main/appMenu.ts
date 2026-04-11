import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import path from 'path'

export type MenuAction =
  | 'newFile'
  | 'newLiveScript'
  | 'openFile'
  | 'save'
  | 'saveAs'
  | 'publishHtml'
  | 'closeTab'
  | 'find'
  | 'findReplace'
  | 'goToLine'
  | 'toggleComment'
  | 'toggleCommandWindow'
  | 'toggleWorkspace'
  | 'toggleFileBrowser'
  | 'toggleCommandHistory'
  | 'toggleStatusBar'
  | 'resetLayout'
  | 'saveLayoutPreset'
  | 'setThemeLight'
  | 'setThemeDark'
  | 'setThemeSystem'
  | 'runScript'
  | 'runSection'
  | 'runAndAdvance'
  | 'stopExecution'
  | 'clearCommandWindow'
  | 'preferences'
  | 'about'

// US-028: The Layouts submenu is driven by these constants (mirrored in
// src/renderer/editor/layoutPresets.ts). Kept inline here so appMenu.ts
// stays a node-friendly module with no React imports.
const BUILTIN_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'debugger', label: 'Debugger' },
  { id: 'twoColumn', label: 'Two-Column' },
  { id: 'codeOnly', label: 'Code-Only' },
]

export function buildAppMenu(
  mainWindow: BrowserWindow,
  recentFiles: string[] = [],
  customPresetNames: string[] = [],
): Menu {
  const send = (action: MenuAction | string): void => {
    mainWindow.webContents.send('menu:action', action)
  }

  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Script',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('newFile'),
        },
        {
          label: 'New Live Script',
          click: () => send('newLiveScript'),
        },
        { type: 'separator' },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('openFile'),
        },
        {
          label: 'Recent Files',
          submenu: recentFiles.length > 0
            ? [
                ...recentFiles.map((filePath) => ({
                  label: path.basename(filePath),
                  toolTip: filePath,
                  click: () => send(`recentFile:${filePath}`),
                })),
                { type: 'separator' as const },
                {
                  label: 'Clear Recent Files',
                  click: () => send('clearRecentFiles'),
                },
              ]
            : [{ label: 'No Recent Files', enabled: false }],
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('saveAs'),
        },
        { type: 'separator' },
        {
          label: 'Publish',
          submenu: [
            {
              label: 'HTML...',
              click: () => send('publishHtml'),
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => send('closeTab'),
        },
        { type: 'separator' },
        isMac
          ? { role: 'close' as const }
          : {
              label: 'Exit',
              accelerator: 'Alt+F4',
              role: 'quit' as const,
            },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('find'),
        },
        {
          label: 'Find & Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => send('findReplace'),
        },
        {
          label: 'Go to Line...',
          accelerator: 'CmdOrCtrl+G',
          click: () => send('goToLine'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Comment',
          accelerator: 'CmdOrCtrl+/',
          click: () => send('toggleComment'),
        },
        { type: 'separator' },
        { role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('preferences'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Command Window',
          click: () => send('toggleCommandWindow'),
        },
        {
          label: 'Toggle Workspace',
          click: () => send('toggleWorkspace'),
        },
        {
          label: 'Toggle File Browser',
          click: () => send('toggleFileBrowser'),
        },
        {
          label: 'Toggle Command History',
          click: () => send('toggleCommandHistory'),
        },
        { type: 'separator' },
        {
          label: 'Layouts',
          submenu: [
            ...BUILTIN_PRESETS.map((p) => ({
              label: p.label,
              click: () => send(`layoutPreset:builtin:${p.id}`),
            })),
            { type: 'separator' as const },
            ...(customPresetNames.length > 0
              ? [
                  ...customPresetNames.map((name) => ({
                    label: name,
                    submenu: [
                      {
                        label: 'Apply',
                        click: () => send(`layoutPreset:custom:${name}`),
                      },
                      {
                        label: 'Delete',
                        click: () => send(`layoutPreset:delete:${name}`),
                      },
                    ],
                  })),
                  { type: 'separator' as const },
                ]
              : []),
            {
              label: 'Save Current as Preset...',
              click: () => send('saveLayoutPreset'),
            },
          ],
        },
        {
          label: 'Reset Layout',
          click: () => send('resetLayout'),
        },
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: [
            {
              label: 'Light',
              click: () => send('setThemeLight'),
            },
            {
              label: 'Dark',
              click: () => send('setThemeDark'),
            },
            {
              label: 'System',
              click: () => send('setThemeSystem'),
            },
          ],
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Run',
      submenu: [
        {
          label: 'Run Script',
          accelerator: 'F5',
          click: () => send('runScript'),
        },
        {
          label: 'Run Section',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => send('runSection'),
        },
        {
          label: 'Run and Advance',
          accelerator: 'CmdOrCtrl+Shift+Enter',
          click: () => send('runAndAdvance'),
        },
        { type: 'separator' },
        {
          label: 'Stop Execution',
          click: () => send('stopExecution'),
        },
        { type: 'separator' },
        {
          label: 'Clear Command Window',
          click: () => send('clearCommandWindow'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About MatSlop',
          click: () => send('about'),
        },
        { type: 'separator' },
        {
          label: 'Octave Documentation',
          click: () => {
            shell.openExternal('https://docs.octave.org/latest/')
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  return menu
}
