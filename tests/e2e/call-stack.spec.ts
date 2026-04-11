import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-018: Call Stack panel.
 *
 * Verifies:
 *   - Panel is hidden (or shows the idle state) when no pause is active.
 *   - Panel appears when a pause is simulated.
 *   - Seeding a synthetic call stack via `__matslopSimulateCallStack` renders
 *     one row per frame, each showing the function name and "file:line".
 *   - Clicking a frame row navigates the editor to that file and flips the
 *     paused-line highlight to the clicked frame's line.
 *   - Clearing the pause hides the panel again.
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

test('call stack panel is hidden when not paused', async () => {
  await expect(window.locator('[data-testid="call-stack-panel"]')).toHaveCount(0)
})

test('panel appears with frames when paused and a stack is seeded', async () => {
  // Open hello.m so there's a tab to navigate to later.
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'hello.m'))
  await expect(
    window.locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]').first(),
  ).toBeVisible()

  // Simulate a pause at line 2 of hello.m.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
    }
    w.__matslopSimulatePaused?.('/some/dir/hello.m', 2)
  })

  // Panel should now be present.
  await expect(window.locator('[data-testid="call-stack-panel"]')).toBeVisible()
  // Idle message rendered until frames arrive (real IPC returns []).
  await expect(window.locator('[data-testid="call-stack-empty"]')).toBeVisible()

  // Seed a three-frame synthetic stack.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulateCallStack?: (
        frames: Array<{ name: string; file: string; line: number }>,
      ) => void
    }
    if (!w.__matslopSimulateCallStack) throw new Error('call stack hook missing')
    w.__matslopSimulateCallStack([
      { name: 'greet', file: '/some/dir/hello.m', line: 2 },
      { name: 'outer', file: '/some/dir/outer.m', line: 10 },
      { name: 'main', file: '/some/dir/main.m', line: 1 },
    ])
  })

  // Three rows render.
  const rows = window.locator('[data-testid="call-stack-row"]')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('greet')
  await expect(rows.nth(0)).toContainText('hello.m:2')
  await expect(rows.nth(1)).toContainText('outer')
  await expect(rows.nth(1)).toContainText('outer.m:10')
  await expect(rows.nth(2)).toContainText('main')
  await expect(rows.nth(2)).toContainText('main.m:1')

  // Top frame is the default selection.
  await expect(rows.nth(0)).toHaveClass(/active/)
})

test('clicking a frame navigates the editor to that file/line', async () => {
  // Continue from the previous test — a stack with 3 frames is seeded and
  // hello.m is the top frame.
  const rows = window.locator('[data-testid="call-stack-row"]')
  await expect(rows).toHaveCount(3)

  // Click the second frame ("outer" in outer.m). We won't have an outer.m
  // tab, but the paused location state should update — that is what drives
  // the editor highlight pipeline in the renderer. Use dispatchEvent so
  // Playwright doesn't fight Allotment's hidden-pane overlays.
  await rows.nth(1).locator('.call-stack-row-btn').dispatchEvent('click')

  // The clicked row is now active.
  await expect(rows.nth(1)).toHaveClass(/active/)
  await expect(rows.nth(0)).not.toHaveClass(/active/)

  // Paused location state should reflect the clicked frame.
  const loc = await window.evaluate(() => {
    const w = window as unknown as {
      __matslopPausedLocation?: { file: string; line: number } | null
    }
    return w.__matslopPausedLocation ?? null
  })
  expect(loc).not.toBeNull()
  expect(loc?.file).toBe('/some/dir/outer.m')
  expect(loc?.line).toBe(10)

  // Click back to the top frame (hello.m) and verify the editor actually
  // surfaces the paused-line highlight on the hello.m tab (it is the only
  // open tab that matches the basename).
  await rows.nth(0).locator('.call-stack-row-btn').dispatchEvent('click')
  await expect(rows.nth(0)).toHaveClass(/active/)
  await expect(window.locator('.matslop-paused-line').first()).toBeVisible()
})

test('clearing the pause hides the call stack panel again', async () => {
  await window.evaluate(() => {
    const w = window as unknown as { __matslopClearPaused?: () => void }
    w.__matslopClearPaused?.()
  })
  await expect(window.locator('[data-testid="call-stack-panel"]')).toHaveCount(0)
})
