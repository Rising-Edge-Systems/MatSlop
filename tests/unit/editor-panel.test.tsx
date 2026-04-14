// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

// ── Mock modules before importing the component ────────────────────────────

// Mock @monaco-editor/react as a simple div stub
vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string }) => (
    <div data-testid="mock-editor">{props.value}</div>
  ),
  __esModule: true,
}))

// Mock LiveScriptEditor
vi.mock('../../src/renderer/editor/LiveScriptEditor', () => ({
  default: (props: { content?: string }) => (
    <div data-testid="mock-livescript-editor">{props.content}</div>
  ),
  __esModule: true,
}))

// Mock AppContext — return a default that says "not provided" so EditorPanel uses props
vi.mock('../../src/renderer/AppContext', () => ({
  useAppContext: () => ({
    _provided: false,
    pendingOpenPath: null,
    pendingOpenLine: null,
    pausedLocation: null,
    editorTheme: null,
    editorSettings: null,
    menuAction: null,
    onFileOpened: undefined,
    onMenuActionConsumed: undefined,
    onRunSection: undefined,
    onRunScript: undefined,
  }),
}))

// Mock OctaveContext used by EditorToolbar
vi.mock('../../src/renderer/OctaveContext', () => ({
  useOctaveStatus: () => 'ready' as const,
}))

// Mock the shortcut manager to prevent keydown listener registration
vi.mock('../../src/renderer/shortcuts/shortcutManager', () => {
  const manager = {
    start: vi.fn(),
    stop: vi.fn(),
    setActiveDefinitions: vi.fn(),
  }
  return { shortcutManager: manager, SHORTCUT_DEFINITIONS: [] }
})

// Mock custom shortcuts
vi.mock('../../src/renderer/shortcuts/customShortcuts', () => ({
  parseStoredOverrides: vi.fn().mockReturnValue([]),
  applyShortcutOverrides: vi.fn().mockReturnValue([]),
  SHORTCUT_DEFINITIONS: [],
}))

// Mock publishHtml (imported by useFileOperations)
vi.mock('../../src/renderer/editor/publishHtml', () => ({
  publishHtml: vi.fn().mockReturnValue('<html></html>'),
}))

// Mock MATLAB language registration (called by TabbedEditor on mount)
vi.mock('../../src/renderer/editor/matlabLanguage', () => ({
  registerMatlabLanguage: vi.fn(),
  MATLAB_LANGUAGE_ID: 'matlab',
}))

// Mock matlabDiagnostics
vi.mock('../../src/renderer/editor/matlabDiagnostics', () => ({
  analyzeMatlabCode: vi.fn().mockReturnValue([]),
  diagnosticsToMarkers: vi.fn().mockReturnValue([]),
}))

// Mock EditorToolbar to avoid needing to mock lucide-react icons
vi.mock('../../src/renderer/editor/EditorToolbar', () => ({
  default: () => <div data-testid="mock-toolbar">Toolbar</div>,
  __esModule: true,
}))

import EditorPanel from '../../src/renderer/panels/EditorPanel'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWindowMatslop() {
  return {
    // Session
    sessionGetRestoreEnabled: vi.fn().mockResolvedValue(false),
    sessionGet: vi.fn().mockResolvedValue(null),
    sessionSet: vi.fn().mockResolvedValue(undefined),
    // File ops
    openFile: vi.fn().mockResolvedValue(null),
    saveFile: vi.fn().mockResolvedValue({ success: true }),
    saveFileAs: vi.fn().mockResolvedValue(null),
    readFile: vi.fn().mockResolvedValue(null),
    recentFilesAdd: vi.fn(),
    confirmClose: vi.fn().mockResolvedValue(2), // cancel by default
    // Config
    configGetShortcuts: vi.fn().mockResolvedValue(null),
    configGetShowWelcome: vi.fn().mockResolvedValue(false),
    configSetShowWelcome: vi.fn(),
    // Debug
    debugReapplyBreakpointsForFile: vi.fn(),
    debugSetBreakpoint: vi.fn(),
    debugClearBreakpoint: vi.fn(),
    debugSetBreakpointCondition: vi.fn(),
    // Publish
    publishSaveDialog: vi.fn().mockResolvedValue(null),
    publishWriteFile: vi.fn().mockResolvedValue(undefined),
    // Misc
    getHomeDir: vi.fn().mockResolvedValue('/home/user'),
  }
}

const defaultProps = {
  panelVisibility: {
    fileBrowser: true,
    workspace: true,
    commandWindow: true,
    commandHistory: true,
  },
  onTogglePanel: vi.fn(),
  engineStatus: 'ready' as const,
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EditorPanel component', () => {
  let mockMatslop: ReturnType<typeof makeWindowMatslop>

  beforeEach(() => {
    vi.useFakeTimers()
    mockMatslop = makeWindowMatslop()
    ;(window as unknown as { matslop: typeof mockMatslop }).matslop = mockMatslop
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('on mount with no session, renders "No files open" empty state', async () => {
    mockMatslop.sessionGetRestoreEnabled.mockResolvedValue(false)

    await act(async () => {
      render(<EditorPanel {...defaultProps} />)
      // Flush the session restore effect (mount → check restore → resolve)
      await vi.runAllTimersAsync()
    })

    expect(screen.getByText('No files open')).toBeTruthy()
    // The empty state should have New File and Open File buttons
    expect(screen.getByText('New File')).toBeTruthy()
    expect(screen.getByText('Open File')).toBeTruthy()
  })

  it('on mount with a saved session, restores tabs and shows the active tab name', async () => {
    mockMatslop.sessionGetRestoreEnabled.mockResolvedValue(true)
    mockMatslop.sessionGet.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      activeTabId: 'tab-1',
      tabs: [
        {
          id: 'tab-1',
          filename: 'hello.m',
          filePath: '/tmp/hello.m',
          mode: 'script',
          content: 'disp("hello")',
          savedContent: 'disp("hello")',
        },
        {
          id: 'tab-2',
          filename: 'world.m',
          filePath: '/tmp/world.m',
          mode: 'script',
          content: 'x = 1;',
          savedContent: 'x = 1;',
        },
      ],
    })

    await act(async () => {
      render(<EditorPanel {...defaultProps} />)
    })

    // Flush multiple rounds of timers + microtasks for the async session restore chain
    // (sessionGetRestoreEnabled → sessionGet → JSON parse → onRestore → RESTORE_SESSION)
    await act(async () => { await vi.runAllTimersAsync() })
    await act(async () => { await vi.runAllTimersAsync() })

    // Tab names should appear in the tab bar
    expect(screen.getByText('hello.m')).toBeTruthy()
    expect(screen.getByText('world.m')).toBeTruthy()
    // "No files open" should not be visible
    expect(screen.queryByText('No files open')).toBeNull()
  })

  it('clicking "New File" in the empty state creates a new tab', async () => {
    mockMatslop.sessionGetRestoreEnabled.mockResolvedValue(false)

    await act(async () => {
      render(<EditorPanel {...defaultProps} />)
      await vi.runAllTimersAsync()
    })

    // Verify empty state is shown
    expect(screen.getByText('No files open')).toBeTruthy()

    // Click "New File" button in the empty state
    await act(async () => {
      fireEvent.click(screen.getByText('New File'))
      await vi.runAllTimersAsync()
    })

    // After clicking, a new tab should appear with "untitled.m"
    expect(screen.getByText('untitled.m')).toBeTruthy()
    // The empty state should be gone
    expect(screen.queryByText('No files open')).toBeNull()
  })
})
