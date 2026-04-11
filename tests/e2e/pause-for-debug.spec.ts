import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-020: Pause running execution (Ctrl+C equivalent for debugger).
 *
 * Verifies:
 *   - The Pause button exists in the editor toolbar.
 *   - It is disabled when the engine is not busy.
 *   - It becomes enabled when the engine transitions to 'busy' and no
 *     debug pause is active.
 *   - Clicking it fires the preload bridge (observed via
 *     window.__matslopLastPauseForDebug).
 *   - Once the debugger is paused (simulated via __matslopSimulatePaused)
 *     the Pause button goes back to disabled — it's only meaningful for
 *     interrupting a non-paused running script.
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

async function setEngineStatus(status: 'ready' | 'busy' | 'disconnected'): Promise<void> {
  await window.evaluate((s) => {
    const w = window as unknown as {
      __matslopSimulateEngineStatus?: (status: string) => void
    }
    if (!w.__matslopSimulateEngineStatus) throw new Error('engine-status hook missing')
    w.__matslopSimulateEngineStatus(s)
  }, status)
}

async function simulatePause(): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
    }
    if (!w.__matslopSimulatePaused) throw new Error('paused hook missing')
    w.__matslopSimulatePaused('/tmp/fake.m', 4)
  })
}

async function clearPause(): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { __matslopClearPaused?: () => void }
    w.__matslopClearPaused?.()
  })
}

async function lastPauseMarker(): Promise<{ at: number } | null> {
  return await window.evaluate(() => {
    const w = window as unknown as { __matslopLastPauseForDebug?: { at: number } }
    return w.__matslopLastPauseForDebug ?? null
  })
}

async function clearLastPauseMarker(): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { __matslopLastPauseForDebug?: unknown }
    w.__matslopLastPauseForDebug = undefined
  })
}

test('pause button is present in the editor toolbar', async () => {
  await expect(window.locator('[data-testid="toolbar-pause"]')).toHaveCount(1)
})

test('pause button is disabled when engine is not busy', async () => {
  await setEngineStatus('ready')
  await expect(window.locator('[data-testid="toolbar-pause"]')).toBeDisabled()
})

test('pause button enables when engine becomes busy and fires pauseForDebug on click', async () => {
  await setEngineStatus('busy')
  await clearLastPauseMarker()
  const btn = window.locator('[data-testid="toolbar-pause"]')
  await expect(btn).toBeEnabled()
  await btn.dispatchEvent('click')
  await expect
    .poll(async () => (await lastPauseMarker()) !== null)
    .toBe(true)
  const marker = await lastPauseMarker()
  expect(marker).not.toBeNull()
  expect(typeof marker?.at).toBe('number')
})

test('pause button is disabled while the debugger is already paused', async () => {
  await setEngineStatus('busy')
  await simulatePause()
  await expect(window.locator('[data-testid="toolbar-pause"]')).toBeDisabled()
  // Clean up for other tests.
  await clearPause()
  await setEngineStatus('disconnected')
})
