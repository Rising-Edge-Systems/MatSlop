// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import type { EditorTab } from '../../src/renderer/editor/editorTypes'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Monaco editor — render a simple div stub
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: { value?: string }) => (
    <div data-testid="mock-monaco-editor">{props.value}</div>
  ),
}))

// Mock LiveScriptEditor
vi.mock('../../src/renderer/editor/LiveScriptEditor', () => ({
  __esModule: true,
  default: (props: { content?: string }) => (
    <div data-testid="mock-livescript-editor">{props.content}</div>
  ),
}))

// Mock matlabLanguage (imported by TabbedEditor)
vi.mock('../../src/renderer/editor/matlabLanguage', () => ({
  registerMatlabLanguage: vi.fn(),
  MATLAB_LANGUAGE_ID: 'matlab',
}))

// Mock matlabDiagnostics
vi.mock('../../src/renderer/editor/matlabDiagnostics', () => ({
  analyzeMatlabCode: vi.fn(() => []),
  diagnosticsToMarkers: vi.fn(() => []),
}))

// Mock editor.css import
vi.mock('../../src/renderer/editor/editor.css', () => ({}))

import TabbedEditor from '../../src/renderer/editor/TabbedEditor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTab(overrides: Partial<EditorTab> & { id: string }): EditorTab {
  return {
    filename: `${overrides.id}.m`,
    content: `% content of ${overrides.id}`,
    savedContent: `% content of ${overrides.id}`,
    filePath: `/path/${overrides.id}.m`,
    mode: 'script' as const,
    ...overrides,
  }
}

const defaultProps = {
  onTabSelect: vi.fn(),
  onTabClose: vi.fn(),
  onContentChange: vi.fn(),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TabbedEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('renders tab names in the tab bar', () => {
    const tabs = [
      makeTab({ id: 'tab-1', filename: 'hello.m' }),
      makeTab({ id: 'tab-2', filename: 'world.m' }),
    ]

    render(
      <TabbedEditor
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      />,
    )

    expect(screen.getByText('hello.m')).toBeTruthy()
    expect(screen.getByText('world.m')).toBeTruthy()
  })

  it('active tab has the "active" CSS class', () => {
    const tabs = [
      makeTab({ id: 'tab-1', filename: 'active.m' }),
      makeTab({ id: 'tab-2', filename: 'inactive.m' }),
    ]

    render(
      <TabbedEditor
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      />,
    )

    const allTabs = screen.getAllByTestId('editor-tab')
    const activeTab = allTabs.find((el) => el.dataset.tabId === 'tab-1')!
    const inactiveTab = allTabs.find((el) => el.dataset.tabId === 'tab-2')!

    expect(activeTab.className).toContain('active')
    expect(inactiveTab.className).not.toContain('active')
  })

  it('clicking a tab calls onTabSelect with the tab ID', () => {
    const onTabSelect = vi.fn()
    const tabs = [
      makeTab({ id: 'tab-1', filename: 'first.m' }),
      makeTab({ id: 'tab-2', filename: 'second.m' }),
    ]

    render(
      <TabbedEditor
        {...defaultProps}
        onTabSelect={onTabSelect}
        tabs={tabs}
        activeTabId="tab-1"
      />,
    )

    const secondTab = screen.getAllByTestId('editor-tab').find(
      (el) => el.dataset.tabId === 'tab-2',
    )!
    fireEvent.click(secondTab)

    expect(onTabSelect).toHaveBeenCalledWith('tab-2')
  })

  it('clicking the close button calls onTabClose with the tab ID', () => {
    const onTabClose = vi.fn()
    const tabs = [
      makeTab({ id: 'tab-1', filename: 'closeme.m' }),
      makeTab({ id: 'tab-2', filename: 'keepme.m' }),
    ]

    render(
      <TabbedEditor
        {...defaultProps}
        onTabClose={onTabClose}
        tabs={tabs}
        activeTabId="tab-1"
      />,
    )

    // Close buttons are inside each tab — find the one for tab-1
    const tab1Element = screen.getAllByTestId('editor-tab').find(
      (el) => el.dataset.tabId === 'tab-1',
    )!
    const closeButton = tab1Element.querySelector('.editor-tab-close')!
    fireEvent.click(closeButton)

    expect(onTabClose).toHaveBeenCalledWith('tab-1')
  })

  it('modified tab (content !== savedContent) shows the unsaved-changes dot', () => {
    const tabs = [
      makeTab({
        id: 'tab-1',
        filename: 'modified.m',
        content: 'changed content',
        savedContent: 'original content',
      }),
      makeTab({
        id: 'tab-2',
        filename: 'clean.m',
        content: 'same',
        savedContent: 'same',
      }),
    ]

    render(
      <TabbedEditor
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      />,
    )

    const tab1 = screen.getAllByTestId('editor-tab').find(
      (el) => el.dataset.tabId === 'tab-1',
    )!
    const tab2 = screen.getAllByTestId('editor-tab').find(
      (el) => el.dataset.tabId === 'tab-2',
    )!

    // Modified tab should have the unsaved indicator
    expect(tab1.querySelector('.editor-tab-modified')).toBeTruthy()
    // Clean tab should NOT have it
    expect(tab2.querySelector('.editor-tab-modified')).toBeNull()
  })

  it('with zero tabs, renders the "No files open" empty state', () => {
    render(
      <TabbedEditor
        {...defaultProps}
        tabs={[]}
        activeTabId={null}
      />,
    )

    expect(screen.getByText('No files open')).toBeTruthy()
  })

  it('close button click does not bubble to onTabSelect', () => {
    const onTabSelect = vi.fn()
    const onTabClose = vi.fn()
    const tabs = [makeTab({ id: 'tab-1', filename: 'test.m' })]

    render(
      <TabbedEditor
        {...defaultProps}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
        tabs={tabs}
        activeTabId="tab-1"
      />,
    )

    const tab1 = screen.getAllByTestId('editor-tab').find(
      (el) => el.dataset.tabId === 'tab-1',
    )!
    const closeButton = tab1.querySelector('.editor-tab-close')!
    fireEvent.click(closeButton)

    expect(onTabClose).toHaveBeenCalledWith('tab-1')
    // The close button calls e.stopPropagation() so onTabSelect should NOT fire
    expect(onTabSelect).not.toHaveBeenCalled()
  })
})
