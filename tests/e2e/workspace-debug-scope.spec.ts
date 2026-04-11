import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-019: The Workspace panel must surface variables of the current stack
 * frame while Octave is paused at a breakpoint, and snap back to the top
 * workspace when debugging ends. This spec exercises the UI-side contract
 * using the `__matslopSimulatePaused` test hook installed by App.tsx so we
 * don't need a real Octave process. The actual `whos` query still flows
 * through the existing refresh pipeline; here we verify that:
 *
 *   1. Entering a paused state bumps `workspaceRefreshTrigger` (so
 *      WorkspacePanel's `useEffect` re-queries whos).
 *   2. A "Debug scope" banner appears in the panel while paused.
 *   3. Leaving the paused state bumps the trigger again (so the panel
 *      snaps back to top-scope whos) and the banner disappears.
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

test('workspace panel refreshes and surfaces debug-scope banner on pause', async () => {
  // Panel is present.
  const panel = window.locator('[data-testid="workspace-panel"]')
  await expect(panel).toBeVisible()

  // Baseline: no debug banner, scope marker is "false".
  await expect(window.locator('[data-testid="workspace-debug-scope"]')).toHaveCount(0)
  await expect(panel).toHaveAttribute('data-debug-scope', 'false')

  // Capture the current refresh counter (App.tsx mirrors
  // workspaceRefreshTrigger onto window for e2e assertions).
  const beforePause = await window.evaluate(() => {
    const w = window as unknown as { __matslopWorkspaceRefreshCount?: number }
    return w.__matslopWorkspaceRefreshCount ?? 0
  })

  // Dispatch a simulated pause at a fake file/line.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
    }
    if (!w.__matslopSimulatePaused) throw new Error('paused hook missing')
    w.__matslopSimulatePaused('/tmp/debug-scope-target.m', 7)
  })

  // The refresh counter should strictly increase — this is the signal that
  // WorkspacePanel will re-query whos for the paused-frame variables.
  await window.waitForFunction(
    (prev) => {
      const w = window as unknown as { __matslopWorkspaceRefreshCount?: number }
      return (w.__matslopWorkspaceRefreshCount ?? 0) > prev
    },
    beforePause,
    { timeout: 5000 }
  )

  // Debug-scope banner should appear and the wrapper's data attribute
  // should flip to 'true'.
  await expect(window.locator('[data-testid="workspace-debug-scope"]')).toBeVisible()
  await expect(window.locator('[data-testid="workspace-debug-scope"]')).toContainText(
    'Debug scope',
  )
  await expect(panel).toHaveAttribute('data-debug-scope', 'true')

  // Snapshot the counter AFTER the pause refresh to verify that leaving
  // paused state triggers another refresh back to the top workspace scope.
  const afterPause = await window.evaluate(() => {
    const w = window as unknown as { __matslopWorkspaceRefreshCount?: number }
    return w.__matslopWorkspaceRefreshCount ?? 0
  })
  expect(afterPause).toBeGreaterThan(beforePause)

  // Clear the pause.
  await window.evaluate(() => {
    const w = window as unknown as { __matslopClearPaused?: () => void }
    w.__matslopClearPaused?.()
  })

  // Counter ticks again (back-to-top-scope refresh) and the banner is gone.
  await window.waitForFunction(
    (prev) => {
      const w = window as unknown as { __matslopWorkspaceRefreshCount?: number }
      return (w.__matslopWorkspaceRefreshCount ?? 0) > prev
    },
    afterPause,
    { timeout: 5000 }
  )
  await expect(window.locator('[data-testid="workspace-debug-scope"]')).toHaveCount(0)
  await expect(panel).toHaveAttribute('data-debug-scope', 'false')
})

test('workspace banner shows the selected frame name when available', async () => {
  // Seed a synthetic call stack, then simulate a pause. The panel should
  // read the top frame's name from the stack and embed it in the banner.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulateCallStack?: (frames: Array<{ name: string; file: string; line: number }>) => void
      __matslopSimulatePaused?: (file: string, line: number) => void
    }
    w.__matslopSimulateCallStack?.([
      { name: 'innerFn', file: '/tmp/inner.m', line: 3 },
      { name: 'outerFn', file: '/tmp/outer.m', line: 12 },
    ])
    w.__matslopSimulatePaused?.('/tmp/inner.m', 3)
  })

  const banner = window.locator('[data-testid="workspace-debug-scope"]')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('innerFn')

  // Clean up for subsequent tests.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopClearPaused?: () => void
      __matslopClearCallStack?: () => void
    }
    w.__matslopClearPaused?.()
    w.__matslopClearCallStack?.()
  })
  await expect(banner).toHaveCount(0)
})
