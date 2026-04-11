import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { fileURLToPath } from 'url'

/**
 * US-034: Session save/restore.
 *
 * Boot the app once, open a file, flush the session to disk, close. Boot
 * again with the SAME userData dir and verify the tab comes back.
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures')

async function bootApp(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [path.join(PROJECT_ROOT, 'dist', 'main', 'index.js')],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MATSLOP_USER_DATA_DIR: userDataDir,
    },
  })
  let window = await app.firstWindow()
  for (let i = 0; i < 30; i++) {
    const wins = app.windows()
    const matched = await Promise.all(
      wins.map(async (w) => ({ w, title: await w.title().catch(() => '') })),
    )
    const real = matched.find((m) => m.title === 'MatSlop')
    if (real) {
      window = real.w
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

test.describe('US-034 session save/restore', () => {
  test('restores tabs opened in a previous launch', async () => {
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'matslop-session-'),
    )

    const helloPath = path.join(FIXTURES_DIR, 'scripts', 'hello.m')
    const sessionFile = path.join(userDataDir, 'session.json')

    // --- Seed session.json directly so the first boot has something to
    //     restore. Writing it via the renderer's sessionSet IPC races with
    //     the debounced autosave on close, which would overwrite it with
    //     the in-memory "untitled.m" tab. Writing to disk BEFORE launch
    //     avoids that race entirely. ----------------------------------
    const content = fs.readFileSync(helloPath, 'utf-8')
    const seed = {
      version: 1,
      savedAt: Date.now(),
      activeTabId: 'tab-restored',
      tabs: [
        {
          id: 'tab-restored',
          filename: 'hello.m',
          filePath: helloPath,
          mode: 'script',
          content,
          savedContent: content,
          cursorLine: 1,
          cursorColumn: 1,
        },
      ],
    }
    fs.writeFileSync(sessionFile, JSON.stringify(seed), 'utf-8')
    expect(fs.existsSync(sessionFile)).toBe(true)

    // --- Second launch: expect hello.m tab to be restored ----------------
    {
      const { app, window } = await bootApp(userDataDir)
      await window.waitForSelector('[data-testid="editor-panel"]')
      // The restored tab should show up in the tab bar.
      await expect(
        window.locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]'),
      ).toHaveCount(1, { timeout: 5000 })
      await app.close()
    }

    // --- Third launch with restore disabled: fresh state -----------------
    {
      const { app, window } = await bootApp(userDataDir)
      await window.waitForSelector('[data-testid="editor-panel"]')
      // Toggle off and flush a fresh session.
      await window.evaluate(async () => {
        await window.matslop.sessionSetRestoreEnabled(false)
      })
      await app.close()
    }
    {
      const { app, window } = await bootApp(userDataDir)
      await window.waitForSelector('[data-testid="editor-panel"]')
      // With restore disabled, hello.m should NOT be auto-opened.
      await expect(
        window.locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]'),
      ).toHaveCount(0, { timeout: 3000 })
      await app.close()
    }

    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  test('unsaved changes land in recovery.json next to session.json', async () => {
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'matslop-session-'),
    )
    const { app, window } = await bootApp(userDataDir)
    await window.waitForSelector('[data-testid="editor-panel"]')

    // Wait a moment for the initial debounced autosave (~400ms) to fire
    // and settle, so our dirty-session push isn't immediately overwritten
    // by the editor panel's first "initial state" autosave.
    await window.waitForTimeout(800)

    // Push a session with a dirty tab.
    await window.evaluate(async () => {
      await window.matslop.sessionSet({
        version: 1,
        savedAt: Date.now(),
        activeTabId: 't1',
        tabs: [
          {
            id: 't1',
            filename: 'dirty.m',
            filePath: null,
            mode: 'script',
            content: 'x = 42 % unsaved',
            savedContent: '',
          },
        ],
      })
    })

    const recoveryFile = path.join(userDataDir, 'recovery.json')
    // IPC sessionSet resolves only after main has written both files, so
    // recovery.json must exist synchronously when we hit this line.
    expect(fs.existsSync(recoveryFile)).toBe(true)
    const rec = JSON.parse(fs.readFileSync(recoveryFile, 'utf-8'))
    expect(rec.tabs[0].content).toContain('x = 42')

    // A subsequent clean-session save should delete recovery.json.
    await window.evaluate(async () => {
      await window.matslop.sessionSet({
        version: 1,
        savedAt: Date.now(),
        activeTabId: null,
        tabs: [],
      })
    })
    for (let i = 0; i < 20; i++) {
      if (!fs.existsSync(recoveryFile)) break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(fs.existsSync(recoveryFile)).toBe(false)

    await app.close()
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })
})
