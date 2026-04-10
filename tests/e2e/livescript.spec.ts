import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, waitForOctaveReady, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, window, userDataDir } = await launchApp())
  await waitForOctaveReady(window)
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('opens basic.mls and parses cells', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'basic.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="basic.mls"]')).toBeVisible()
  // LiveScript editor should render the markdown title
  const editor = window.locator('.tabbed-editor')
  await expect(editor).toContainText('Basic Live Script')
})

test('opens multicell.mls with multiple cells', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()
  const editor = window.locator('.tabbed-editor')
  await expect(editor).toContainText('Multi-Cell Test')
  await expect(editor).toContainText('Now multiply them')
})

test('drag cell 2 above cell 1 reorders the DOM', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  // Capture the initial cell-id order
  const idsBefore = await window
    .locator('[data-testid="ls-cell"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.cellId))
  expect(idsBefore.length).toBeGreaterThanOrEqual(2)

  // Simulate HTML5 drag-and-drop: drag cell at index 1 into the drop-zone
  // directly above index 0 (i.e. to the very top).
  // Native drag events in Playwright are unreliable, so dispatch them
  // manually with a shared DataTransfer-like stub.
  await window.evaluate(() => {
    const sourceHandle = document.querySelectorAll('[data-testid="ls-cell-drag-handle"]')[1] as HTMLElement
    const topZone = document.querySelector('[data-testid="ls-drop-zone"][data-drop-index="0"]') as HTMLElement
    if (!sourceHandle || !topZone) throw new Error('missing drag targets')
    const dt = new DataTransfer()
    const fire = (el: HTMLElement, type: string): void => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
      el.dispatchEvent(ev)
    }
    fire(sourceHandle, 'dragstart')
    fire(topZone, 'dragenter')
    fire(topZone, 'dragover')
    fire(topZone, 'drop')
    fire(sourceHandle, 'dragend')
  })

  const idsAfter = await window
    .locator('[data-testid="ls-cell"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.cellId))
  expect(idsAfter.length).toBe(idsBefore.length)
  // Cell that was at index 1 is now at index 0
  expect(idsAfter[0]).toBe(idsBefore[1])
  expect(idsAfter[1]).toBe(idsBefore[0])
})
