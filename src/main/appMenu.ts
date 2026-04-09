import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export type MenuAction =
  | 'newFile'
  | 'newLiveScript'
  | 'openFile'
  | 'save'
  | 'saveAs'
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
  | 'setThemeLight'
  | 'setThemeDark'
  | 'setThemeSystem'
  | 'runScript'
  | 'runSection'
  | 'stopExecution'
  | 'clearCommandWindow'
  | 'about'

export function buildAppMenu(mainWindow: BrowserWindow): Menu {
  const send = (action: MenuAction): void => {
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
          enabled: false, // Placeholder for future US-023
        },
        { type: 'separator' },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('openFile'),
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
