import { test, expect } from '@playwright/test'
import { launchApp, closeApp, waitForOctaveReady } from './helpers/launch'
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

async function runCommand(window: Page, cmd: string): Promise<void> {
  const input = window.locator('[data-testid="command-input"]')
  await input.click()
  await input.fill(cmd)
  await input.press('Enter')
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 15000 }
  )
}

test('workspace panel is visible', async () => {
  await expect(window.locator('[data-testid="workspace-panel"]')).toBeVisible()
})

test('variables appear after assignment', async () => {
  await runCommand(window, 'clear all;')
  await runCommand(window, 'wspace_var_1 = 42;')
  await runCommand(window, 'wspace_var_2 = [1 2 3];')
  // Allow workspace refresh
  await window.waitForTimeout(1000)
  const panel = window.locator('[data-testid="workspace-panel"]')
  await expect(panel).toContainText('wspace_var_1')
  await expect(panel).toContainText('wspace_var_2')
})

test('clear all empties workspace', async () => {
  await runCommand(window, 'zzz = 999;')
  await window.waitForTimeout(500)
  const panel = window.locator('[data-testid="workspace-panel"]')
  await expect(panel).toContainText('zzz')
  await runCommand(window, 'clear all;')
  await window.waitForTimeout(1000)
  // After clear, zzz should be gone
  const text = await panel.textContent()
  expect(text).not.toContain('zzz')
})
