// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Mock OctaveContext — return 'ready' by default
const mockUseOctaveStatus = vi.fn(() => 'ready' as const)
vi.mock('../../src/renderer/OctaveContext', () => ({
  useOctaveStatus: () => mockUseOctaveStatus(),
}))

// Mock lucide-react icons as simple SVG stubs with title pass-through
vi.mock('lucide-react', () => {
  const icon = (name: string) => {
    const Component = (props: Record<string, unknown>) => (
      <svg data-testid={`icon-${name}`} {...props} />
    )
    Component.displayName = name
    return Component
  }
  return {
    FilePlus: icon('FilePlus'),
    FolderOpen: icon('FolderOpen'),
    Save: icon('Save'),
    Play: icon('Play'),
    Pause: icon('Pause'),
    Square: icon('Square'),
    LayoutList: icon('LayoutList'),
    FastForward: icon('FastForward'),
    Redo2: icon('Redo2'),
    ArrowDownToLine: icon('ArrowDownToLine'),
    SkipForward: icon('SkipForward'),
    ChevronDown: icon('ChevronDown'),
  }
})

// Mock editor.css
vi.mock('../../src/renderer/editor/editor.css', () => ({}))

import EditorToolbar from '../../src/renderer/editor/EditorToolbar'

describe('EditorToolbar', () => {
  const defaultProps = {
    hasActiveFile: true,
    onNewFile: vi.fn(),
    onNewLiveScript: vi.fn(),
    onOpenFile: vi.fn(),
    onSave: vi.fn(),
    onRun: vi.fn(),
    onStop: vi.fn(),
    onRunSection: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseOctaveStatus.mockReturnValue('ready')
    cleanup()
  })

  it('New File button calls onNewFile on click', () => {
    render(<EditorToolbar {...defaultProps} />)
    const newFileBtn = screen.getByTitle('New Script (Ctrl+N)')
    fireEvent.click(newFileBtn)
    expect(defaultProps.onNewFile).toHaveBeenCalledOnce()
  })

  it('dropdown chevron toggles the new-file dropdown menu visibility', () => {
    render(<EditorToolbar {...defaultProps} />)
    const chevronBtn = screen.getByTitle('New file options')

    // Dropdown is initially hidden
    expect(screen.queryByText('Live Script (.mls)')).toBeNull()

    // Click to open
    fireEvent.click(chevronBtn)
    expect(screen.getByText('Live Script (.mls)')).toBeTruthy()
    expect(screen.getByText('Script (.m)')).toBeTruthy()

    // Click again to close
    fireEvent.click(chevronBtn)
    expect(screen.queryByText('Live Script (.mls)')).toBeNull()
  })

  it('clicking "Live Script (.mls)" in dropdown calls onNewLiveScript', () => {
    render(<EditorToolbar {...defaultProps} />)
    // Open dropdown
    fireEvent.click(screen.getByTitle('New file options'))
    // Click the Live Script option
    fireEvent.click(screen.getByText('Live Script (.mls)'))
    expect(defaultProps.onNewLiveScript).toHaveBeenCalledOnce()
  })

  it('dropdown closes when clicking outside (mousedown event)', () => {
    render(<EditorToolbar {...defaultProps} />)
    // Open dropdown
    fireEvent.click(screen.getByTitle('New file options'))
    expect(screen.getByText('Live Script (.mls)')).toBeTruthy()

    // Click outside — simulate mousedown on document body
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Live Script (.mls)')).toBeNull()
  })

  it('Run button is disabled when hasActiveFile is false', () => {
    render(<EditorToolbar {...defaultProps} hasActiveFile={false} />)
    const runBtn = screen.getByTitle('Run (F5)') as HTMLButtonElement
    expect(runBtn.disabled).toBe(true)
  })

  it('Save button is disabled when hasActiveFile is false', () => {
    render(<EditorToolbar {...defaultProps} hasActiveFile={false} />)
    const saveBtn = screen.getByTitle('Save (Ctrl+S)') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })
})
