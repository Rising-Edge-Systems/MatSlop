import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-023: edit-and-continue (best effort).
 *
 * When the user saves a .m file while the debugger is paused, we want:
 *   1. A visible warning banner telling them changes take effect on re-entry
 *   2. Breakpoints for that file re-applied through the debug bridge
 *   3. Auto-dismissal when the debugger resumes
 *   4. Manual dismissal via the banner's close button
 *
 * Real file saves + real Octave are painful to wire up in e2e, so we exercise
 * the same renderer-side handler EditorPanel.handleSave calls — exposed via a
 * dedicated test hook `window.__matslopSimulateFileSavedWhilePaused` set up
 * in App.tsx.
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

test('banner appears when a .m file is saved while paused', async () => {
  // Baseline: no banner.
  await expect(
    window.locator('[data-testid="edit-continue-banner"]'),
  ).toHaveCount(0)

  // Enter paused state + simulate a save-while-paused for /tmp/foo.m.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
      __matslopSimulateFileSavedWhilePaused?: (filePath: string) => void
    }
    if (!w.__matslopSimulatePaused) throw new Error('paused hook missing')
    if (!w.__matslopSimulateFileSavedWhilePaused) {
      throw new Error('edit-continue hook missing')
    }
    w.__matslopSimulatePaused('/tmp/foo.m', 5)
    w.__matslopSimulateFileSavedWhilePaused('/tmp/foo.m')
  })

  const banner = window.locator('[data-testid="edit-continue-banner"]')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('foo.m')
  await expect(banner).toContainText('re-entered')
})

test('banner dismiss button closes the notice', async () => {
  // Fire another save so the banner is definitely visible.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulateFileSavedWhilePaused?: (filePath: string) => void
    }
    w.__matslopSimulateFileSavedWhilePaused?.('/tmp/foo.m')
  })
  const banner = window.locator('[data-testid="edit-continue-banner"]')
  await expect(banner).toBeVisible()

  await window
    .locator('[data-testid="edit-continue-banner-close"]')
    .dispatchEvent('click')

  await expect(banner).toHaveCount(0)
})

test('banner auto-dismisses when debugger resumes', async () => {
  // Fire save-while-paused again to re-raise the banner.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulateFileSavedWhilePaused?: (filePath: string) => void
    }
    w.__matslopSimulateFileSavedWhilePaused?.('/tmp/bar.m')
  })
  await expect(
    window.locator('[data-testid="edit-continue-banner"]'),
  ).toBeVisible()

  // Clear the paused state → banner should disappear.
  await window.evaluate(() => {
    const w = window as unknown as { __matslopClearPaused?: () => void }
    w.__matslopClearPaused?.()
  })
  await expect(
    window.locator('[data-testid="edit-continue-banner"]'),
  ).toHaveCount(0)
})

test('edit-continue banner mirror exposes the current state on window', async () => {
  // Enter paused + simulate save.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
      __matslopSimulateFileSavedWhilePaused?: (filePath: string) => void
    }
    w.__matslopSimulatePaused?.('/tmp/baz.m', 1)
    w.__matslopSimulateFileSavedWhilePaused?.('/tmp/baz.m')
  })

  // The mirror should reflect the banner state with the new filename.
  await window.waitForFunction(() => {
    const w = window as unknown as {
      __matslopEditContinueBanner?: { filename: string; id: number } | null
    }
    return w.__matslopEditContinueBanner?.filename === 'baz.m'
  })

  // Clean up for any subsequent tests.
  await window.evaluate(() => {
    const w = window as unknown as { __matslopClearPaused?: () => void }
    w.__matslopClearPaused?.()
  })
})
