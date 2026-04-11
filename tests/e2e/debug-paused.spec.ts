import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-016: the renderer-facing half of "detect and surface execution-paused
 * events". The parser that scans Octave's stdout/stderr is covered by
 * tests/unit/debug-paused.test.ts; this spec drives the UI directly via the
 * `window.__matslopSimulatePaused` test hook exposed by App.tsx so we don't
 * need a real Octave process running.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('status bar surfaces "Debug: paused" when a pause is dispatched', async () => {
  // Baseline: no paused badge.
  await expect(window.locator('[data-testid="status-debug-paused"]')).toHaveCount(0)

  // Dispatch a simulated pause.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
    }
    if (!w.__matslopSimulatePaused) throw new Error('paused hook missing')
    w.__matslopSimulatePaused('/tmp/fake.m', 4)
  })

  await expect(window.locator('[data-testid="status-debug-paused"]')).toBeVisible()
  await expect(window.locator('[data-testid="status-debug-paused"]')).toContainText(
    'Debug: paused',
  )

  // Clear the pause and the badge should disappear.
  await window.evaluate(() => {
    const w = window as unknown as { __matslopClearPaused?: () => void }
    w.__matslopClearPaused?.()
  })
  await expect(window.locator('[data-testid="status-debug-paused"]')).toHaveCount(0)
})

test('paused-line glyph appears on a matching open tab', async () => {
  // Open hello.m and ensure the tab is active.
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'hello.m'))
  const tabLocator = window
    .locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]')
    .first()
  await expect(tabLocator).toBeVisible()
  // Wait for Monaco's glyph margin to exist.
  await expect(window.locator('.monaco-editor .glyph-margin').first()).toBeVisible()

  // Simulate a pause at line 2 of hello.m (use an absolute path to exercise
  // the basename-matching path in both EditorPanel and TabbedEditor).
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
    }
    w.__matslopSimulatePaused?.('/absolute/path/hello.m', 2)
  })

  // Green-arrow decoration should appear somewhere in the glyph margin.
  await expect(window.locator('.matslop-paused-glyph').first()).toBeVisible()
  // And the whole-line highlight should be present.
  await expect(window.locator('.matslop-paused-line').first()).toBeVisible()
  // Status bar badge is visible.
  await expect(window.locator('[data-testid="status-debug-paused"]')).toBeVisible()

  // Clear.
  await window.evaluate(() => {
    const w = window as unknown as { __matslopClearPaused?: () => void }
    w.__matslopClearPaused?.()
  })

  // Decoration should disappear after clearing.
  await expect(window.locator('.matslop-paused-glyph')).toHaveCount(0)
  await expect(window.locator('[data-testid="status-debug-paused"]')).toHaveCount(0)
})
