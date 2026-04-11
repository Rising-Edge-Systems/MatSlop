import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { fileURLToPath } from 'url'

/**
 * US-Q02: kill the Command History ghost tab for persisted layouts.
 *
 * Pre-seeds electron-store's `config.json` with a saved rc-dock layout
 * that contains a `matslop-command-history` tab even though
 * `panelVisibility.commandHistory` is `false`. After launch, the rendered
 * DOM must NOT contain `[data-testid="dock-tab-matslop-command-history"]`
 * — the sanitizer must strip the ghost on the load path AND the migration
 * must rewrite the saved layout so the ghost cannot resurrect on a
 * subsequent launch.
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

async function bootApp(
  userDataDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
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

/**
 * Build a minimal rc-dock-shaped saved layout that includes a hidden
 * Command History tab living next to the Command Window. We don't import
 * rc-dock here (it isn't installed locally — see progress.txt) so the
 * fixture is hand-rolled to match the `LayoutBase` JSON shape that
 * `DockLayout.saveLayout()` produces.
 */
function fixtureLayoutWithGhostHistory(): unknown {
  return {
    dockbox: {
      mode: 'horizontal',
      children: [
        {
          size: 150,
          tabs: [{ id: 'matslop-file-browser' }],
        },
        {
          mode: 'vertical',
          size: 650,
          children: [
            { size: 600, tabs: [{ id: 'matslop-editor' }] },
            {
              size: 300,
              tabs: [
                { id: 'matslop-command-window' },
                // The ghost tab. Visibility is false in the seeded
                // panelVisibility below, so the sanitizer must remove it.
                { id: 'matslop-command-history' },
              ],
              activeId: 'matslop-command-history',
            },
          ],
        },
        {
          mode: 'vertical',
          size: 200,
          children: [{ size: 300, tabs: [{ id: 'matslop-workspace' }] }],
        },
      ],
    },
  }
}

test.describe('US-Q02 — Command History ghost tab', () => {
  test('does not render the matslop-command-history tab when commandHistory is false', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-q02-'))
    const configPath = path.join(userDataDir, 'config.json')

    // Pre-seed electron-store with a layout containing the ghost tab.
    const seed = {
      theme: 'dark',
      layout: {
        panelVisibility: {
          fileBrowser: true,
          workspace: true,
          commandWindow: true,
          commandHistory: false,
        },
        panelSizes: {
          fileBrowserWidth: 220,
          workspaceWidth: 280,
          bottomHeight: 200,
          commandHistoryWidth: 250,
        },
        dockLayout: fixtureLayoutWithGhostHistory(),
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(seed), 'utf-8')

    try {
      const { app, window } = await bootApp(userDataDir)

      // Wait for the dock to mount.
      await window.waitForSelector('[data-testid="matslop-dock-layout"]', {
        timeout: 10000,
      })
      // Wait for at least one known panel to be visible.
      await window.waitForSelector('[data-testid="dock-tab-matslop-command-window"]', {
        timeout: 10000,
      })

      // The ghost tab MUST NOT render.
      await expect(
        window.locator('[data-testid="dock-tab-matslop-command-history"]'),
      ).toHaveCount(0)

      // Migration: the saved layout on disk must have been rewritten so
      // the ghost id is gone — otherwise it would resurrect next launch.
      // Allow a brief moment for the migration's layoutSet IPC to flush.
      await window.waitForTimeout(500)
      const after = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        layout?: { dockLayout?: unknown }
      }
      const serialized = JSON.stringify(after.layout?.dockLayout ?? {})
      expect(serialized).not.toContain('matslop-command-history')

      await app.close()
    } finally {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })
})
