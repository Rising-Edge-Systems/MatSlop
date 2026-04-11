import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-017: Debug toolbar (continue / step / step in / step out / stop).
 *
 * Verifies:
 *   - Toolbar is hidden when not paused.
 *   - Toolbar appears when a pause is simulated.
 *   - Each button dispatches the correct Octave command
 *     (observed via window.__matslopLastDebugCommand).
 *   - Keyboard shortcuts F5 / F10 / F11 / Shift+F11 / Shift+F5 map to the
 *     same commands when paused.
 *   - After a debug command is dispatched the toolbar re-hides.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

async function simulatePause(): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
    }
    if (!w.__matslopSimulatePaused) throw new Error('paused hook missing')
    w.__matslopSimulatePaused('/tmp/fake.m', 4)
  })
}

async function lastDebugCommand(): Promise<{ action: string; command: string } | null> {
  return await window.evaluate(() => {
    const w = window as unknown as {
      __matslopLastDebugCommand?: { action: string; command: string }
    }
    return w.__matslopLastDebugCommand ?? null
  })
}

async function clearLastDebugCommand(): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { __matslopLastDebugCommand?: unknown }
    w.__matslopLastDebugCommand = undefined
  })
}

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('debug toolbar is hidden when not paused', async () => {
  await expect(window.locator('[data-testid="debug-toolbar"]')).toHaveCount(0)
})

test('debug toolbar appears with all five buttons when paused', async () => {
  await simulatePause()
  await expect(window.locator('[data-testid="debug-toolbar"]')).toBeVisible()
  for (const id of [
    'debug-continue',
    'debug-step-over',
    'debug-step-in',
    'debug-step-out',
    'debug-stop',
  ]) {
    await expect(window.locator(`[data-testid="${id}"]`)).toBeVisible()
  }
})

test('each button dispatches the correct Octave command', async () => {
  const cases: Array<[string, string, string]> = [
    ['debug-continue', 'continue', 'dbcont'],
    ['debug-step-over', 'stepOver', 'dbstep'],
    ['debug-step-in', 'stepIn', 'dbstep in'],
    ['debug-step-out', 'stepOut', 'dbstep out'],
    ['debug-stop', 'stop', 'dbquit'],
  ]
  for (const [testid, action, command] of cases) {
    await simulatePause()
    await clearLastDebugCommand()
    await window.locator(`[data-testid="${testid}"]`).dispatchEvent('click')
    const last = await lastDebugCommand()
    expect(last).not.toBeNull()
    expect(last?.action).toBe(action)
    expect(last?.command).toBe(command)
    // After dispatch, toolbar hides until the next paused event.
    await expect(window.locator('[data-testid="debug-toolbar"]')).toHaveCount(0)
  }
})

test('keyboard shortcuts trigger debug commands when paused', async () => {
  const cases: Array<[string, { shift?: boolean }, string, string]> = [
    ['F5', {}, 'continue', 'dbcont'],
    ['F10', {}, 'stepOver', 'dbstep'],
    ['F11', {}, 'stepIn', 'dbstep in'],
    ['F11', { shift: true }, 'stepOut', 'dbstep out'],
    ['F5', { shift: true }, 'stop', 'dbquit'],
  ]
  for (const [key, mods, action, command] of cases) {
    await simulatePause()
    await clearLastDebugCommand()
    await window.keyboard.press(mods.shift ? `Shift+${key}` : key)
    // Allow React's state effect to run.
    await expect
      .poll(async () => (await lastDebugCommand())?.action ?? null)
      .toBe(action)
    const last = await lastDebugCommand()
    expect(last?.command).toBe(command)
  }
})
