import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')

/**
 * Launches the built Electron app with an isolated user data directory
 * so tests don't pollute the developer's real config.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; window: Page; userDataDir: string }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-e2e-'))

  const app = await electron.launch({
    args: [
      path.join(PROJECT_ROOT, 'dist', 'main', 'index.js'),
    ],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MATSLOP_USER_DATA_DIR: userDataDir,
    },
  })

  // Forward main process logs to test output for debugging
  app.process().stdout?.on('data', (d) => process.stdout.write(`[main stdout] ${d}`))
  app.process().stderr?.on('data', (d) => process.stderr.write(`[main stderr] ${d}`))

  // Wait for the actual app window (not devtools or blank).
  let window = await app.firstWindow()
  // Sometimes the first window is empty; wait a moment then poll for the right one.
  for (let i = 0; i < 30; i++) {
    const wins = app.windows()
    const matched = await Promise.all(
      wins.map(async (w) => ({ w, title: await w.title().catch(() => '') }))
    )
    const real = matched.find((m) => m.title === 'MatSlop')
    if (real) {
      window = real.w
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await window.waitForLoadState('domcontentloaded')

  return { app, window, userDataDir }
}

export async function closeApp(app: ElectronApplication, userDataDir: string): Promise<void> {
  try {
    await app.close()
  } catch {
    // ignore close errors
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
}

export async function waitForOctaveReady(window: Page, timeoutMs = 30000): Promise<void> {
  await window.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="engine-status"]')
      return el?.textContent?.includes('Ready') ?? false
    },
    { timeout: timeoutMs }
  )
}

export const FIXTURES_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures')

/**
 * Opens a file in the editor by invoking the internal "recent file" menu action.
 * Uses a test-only preload API gated on MATSLOP_USER_DATA_DIR being set.
 */
export async function openFileInEditor(window: Page, filePath: string): Promise<void> {
  await window.evaluate(async (fp) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).matslop._testMenuAction('recentFile:' + fp)
  }, filePath)
}
