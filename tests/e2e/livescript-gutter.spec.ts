import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, waitForOctaveReady, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-005: Preserve cell gutter (run button, grip, delete) in grid layout.
 *
 * Verifies that after the US-004 CSS-grid refactor, every per-cell control
 * is still present, scoped to the code column, and functional:
 *   - Run button lives inside .ls-cell-code-side (code column header)
 *   - Drag handle lives inside .ls-cell-code-side and still reorders cells
 *   - Delete button lives inside .ls-cell-code-side and removes the cell
 *   - Add-cell rows span both grid columns (grid-column: 1 / -1)
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())
  await waitForOctaveReady(window)
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('run button, drag handle and delete button live inside the code column for every code cell', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const report = await window.evaluate(() => {
    const codeSides = Array.from(
      document.querySelectorAll('[data-testid="ls-cell"][data-cell-type="code"]')
    ) as HTMLElement[]
    return codeSides.map((code) => {
      const runBtn = code.querySelector('.ls-cell-run-btn') as HTMLElement | null
      const runIcon = code.querySelector('.ls-cell-running-icon') as HTMLElement | null
      const dragHandle = code.querySelector('[data-testid="ls-cell-drag-handle"]') as HTMLElement | null
      const deleteBtn = code.querySelector('.ls-cell-delete-btn') as HTMLElement | null
      return {
        cellId: code.dataset.cellId,
        hasCodeSideClass: code.classList.contains('ls-cell-code-side'),
        hasRunControl: !!(runBtn || runIcon),
        runButtonInside: !!runBtn && code.contains(runBtn),
        dragHandleDraggable: !!dragHandle && dragHandle.getAttribute('draggable') === 'true',
        dragHandleInside: !!dragHandle && code.contains(dragHandle),
        deleteButtonInside: !!deleteBtn && code.contains(deleteBtn),
      }
    })
  })

  expect(report.length).toBeGreaterThan(0)
  for (const r of report) {
    expect(r.hasCodeSideClass, `cell ${r.cellId} missing .ls-cell-code-side`).toBe(true)
    expect(r.hasRunControl, `cell ${r.cellId} missing run button or spinner`).toBe(true)
    expect(r.runButtonInside, `cell ${r.cellId} run button not inside code side`).toBe(true)
    expect(r.dragHandleDraggable, `cell ${r.cellId} drag handle not draggable`).toBe(true)
    expect(r.dragHandleInside, `cell ${r.cellId} drag handle not inside code side`).toBe(true)
    expect(r.deleteButtonInside, `cell ${r.cellId} delete button not inside code side`).toBe(true)
  }
})

test('delete button on a code cell removes that cell from the grid', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const codeCells = window.locator('[data-testid="ls-cell"][data-cell-type="code"]')
  const before = await codeCells.count()
  expect(before).toBeGreaterThanOrEqual(2)

  // Capture the id of the first code cell so we can assert it disappears
  const firstCellId = await codeCells.first().getAttribute('data-cell-id')

  // Force-click (delete button is opacity: 0 by default, only visible on hover,
  // but still in the DOM and clickable)
  await codeCells
    .first()
    .locator('.ls-cell-delete-btn')
    .click({ force: true })

  await expect(
    window.locator(`[data-testid="ls-cell"][data-cell-id="${firstCellId}"]`)
  ).toHaveCount(0)
  await expect(codeCells).toHaveCount(before - 1)
})

test('add-cell rows span both grid columns (grid-column: 1 / -1)', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const spans = await window.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('.ls-cells-grid > .ls-add-cell-row')
    ) as HTMLElement[]
    return rows.map((r) => {
      const cs = window.getComputedStyle(r)
      return {
        gridColumnStart: cs.gridColumnStart,
        gridColumnEnd: cs.gridColumnEnd,
      }
    })
  })
  expect(spans.length).toBeGreaterThan(0)
  for (const s of spans) {
    // `grid-column: 1 / -1` resolves to start=1 and end=-1 (or the number of tracks + 1).
    expect(s.gridColumnStart).toBe('1')
    // Accept either the literal '-1' form or the resolved numeric form (browsers vary)
    const endOk = s.gridColumnEnd === '-1' || s.gridColumnEnd === '3' || s.gridColumnEnd === '2'
    expect(endOk, `grid-column-end was ${s.gridColumnEnd}`).toBe(true)
  }
})

test('drag handle still reorders code cells inside the grid layout', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  // Get initial order of ALL cells (markdown + code) by data-cell-id
  const initialOrder = await window.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="ls-cell"]')).map(
      (el) => (el as HTMLElement).dataset.cellId
    )
  )
  expect(initialOrder.length).toBeGreaterThanOrEqual(3)

  // Drag the LAST cell above the FIRST using synthetic HTML5 drag events.
  // (Playwright's native drag is flaky for react-driven HTML5 drag-and-drop.)
  await window.evaluate(() => {
    const cells = Array.from(
      document.querySelectorAll('[data-testid="ls-cell"]')
    ) as HTMLElement[]
    const source = cells[cells.length - 1]
    const sourceHandle = source.querySelector('[data-testid="ls-cell-drag-handle"]') as HTMLElement
    const dropZones = Array.from(
      document.querySelectorAll('[data-testid="ls-drop-zone"]')
    ) as HTMLElement[]
    const targetZone = dropZones[0] // drop-index 0 = above the first cell
    const dt = new DataTransfer()
    sourceHandle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    targetZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
    targetZone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
    sourceHandle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  })

  await window.waitForTimeout(100)

  const newOrder = await window.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="ls-cell"]')).map(
      (el) => (el as HTMLElement).dataset.cellId
    )
  )
  expect(newOrder.length).toBe(initialOrder.length)
  // The cell that was last should now be first
  expect(newOrder[0]).toBe(initialOrder[initialOrder.length - 1])
  expect(newOrder).not.toEqual(initialOrder)
})
