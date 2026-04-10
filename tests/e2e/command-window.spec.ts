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
  // Wait for engine to go busy then ready again
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 15000 }
  )
}

test('executes 2+2 and shows 4 in output', async () => {
  await runCommand(window, '2+2')
  const output = window.locator('[data-testid="command-output"]')
  await expect(output).toContainText('4')
})

test('executes disp(\'hello world\')', async () => {
  await runCommand(window, "disp('hello world')")
  const output = window.locator('[data-testid="command-output"]')
  await expect(output).toContainText('hello world')
})

test('persists variables across commands', async () => {
  await runCommand(window, 'myvar = 12345;')
  await runCommand(window, 'disp(myvar)')
  const output = window.locator('[data-testid="command-output"]')
  await expect(output).toContainText('12345')
})

test('matrix operations work', async () => {
  await runCommand(window, 'M = [10 20; 30 40];')
  await runCommand(window, 'disp(sum(M(:)))')
  const output = window.locator('[data-testid="command-output"]')
  await expect(output).toContainText('100')
})

test('error message displays in output', async () => {
  await runCommand(window, "error('intentional test error xyz')")
  const output = window.locator('[data-testid="command-output"]')
  await expect(output).toContainText('intentional test error xyz')
})

test('command echo appears with >> prefix', async () => {
  await runCommand(window, 'pi')
  const output = window.locator('[data-testid="command-output"]')
  await expect(output).toContainText('>>')
  await expect(output).toContainText('pi')
})

test('history navigation with up arrow', async () => {
  await runCommand(window, 'a_history_test = 999;')
  const input = window.locator('[data-testid="command-input"]')
  await input.click()
  await input.press('ArrowUp')
  const value = await input.inputValue()
  expect(value).toContain('a_history_test')
})

test('REGRESSION: no "command already running" error on rapid input', async () => {
  // After running a command, the input should accept the next one
  await runCommand(window, '1+1')
  await runCommand(window, '2+2')
  await runCommand(window, '3+3')
  const output = window.locator('[data-testid="command-output"]')
  // Should not contain "already running" error
  const text = await output.textContent()
  expect(text).not.toContain('already running')
})
