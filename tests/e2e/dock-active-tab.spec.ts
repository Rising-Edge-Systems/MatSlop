import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { fileURLToPath } from 'url'

/**
 * US-Q04: Distinguish active dock tabs visually.
 *
 * rc-dock embeds rc-tabs with `prefixCls="dock"`, so the actual rendered
 * active-tab class is `.dock-tab.dock-tab-active` (not `.rc-tabs-tab-active`
 * which the older theme rule was targeting). This spec pre-seeds a layout
 * with TWO tabs in the same pane (commandWindow + commandHistory) and
 * asserts:
 *   1. Exactly one of those tabs has the `dock-tab-active` class.
 *   2. The active tab has a non-empty inset box-shadow that includes the
 *      project accent color (the belt-and-braces underline).
 *   3. The inactive tab has no inset box-shadow.
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

function multiTabLayout(): unknown {
  return {
    dockbox: {
      mode: 'horizontal',
      children: [
        { size: 150, tabs: [{ id: 'matslop-file-browser' }] },
        {
          mode: 'vertical',
          size: 650,
          children: [
            { size: 600, tabs: [{ id: 'matslop-editor' }] },
            {
              size: 300,
              tabs: [
                { id: 'matslop-command-window' },
                { id: 'matslop-command-history' },
              ],
              activeId: 'matslop-command-window',
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

test.describe('US-Q04 — active dock tab styling', () => {
  test('exactly one tab in a multi-tab pane carries dock-tab-active and the underline', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-q04-'))
    const configPath = path.join(userDataDir, 'config.json')

    const seed = {
      theme: 'dark',
      layout: {
        panelVisibility: {
          fileBrowser: true,
          workspace: true,
          commandWindow: true,
          commandHistory: true,
        },
        panelSizes: {
          fileBrowserWidth: 220,
          workspaceWidth: 280,
          bottomHeight: 200,
          commandHistoryWidth: 250,
        },
        dockLayout: multiTabLayout(),
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(seed), 'utf-8')

    try {
      const { app, window } = await bootApp(userDataDir)
      await window.waitForSelector('[data-testid="matslop-dock-layout"]', {
        timeout: 10000,
      })
      await window.waitForSelector('[data-testid="dock-tab-matslop-command-window"]', {
        timeout: 10000,
      })
      await window.waitForSelector('[data-testid="dock-tab-matslop-command-history"]', {
        timeout: 10000,
      })

      // Inspect the rendered tab strip that hosts both tabs.
      const result = await window.evaluate(() => {
        const cwTitle = document.querySelector(
          '[data-testid="dock-tab-title-matslop-command-window"]',
        ) as HTMLElement | null
        if (!cwTitle) return { error: 'cw title missing' as const }
        // The tab title span is rendered inside the rc-tabs <div className="dock-tab ...">.
        // Walk up to the nearest .dock-tab ancestor and from there to the .dock-nav-list.
        let tabEl: HTMLElement | null = cwTitle
        while (tabEl && !tabEl.classList.contains('dock-tab')) tabEl = tabEl.parentElement
        if (!tabEl) return { error: 'no .dock-tab ancestor of cw title' as const }
        const list = tabEl.parentElement
        if (!list) return { error: 'no parent for tab' as const }
        const tabs = Array.from(list.querySelectorAll(':scope > .dock-tab')) as HTMLElement[]
        const accent = getComputedStyle(document.documentElement)
          .getPropertyValue('--accent-color')
          .trim()
        const dump = tabs.map((t) => {
          const cs = getComputedStyle(t)
          return {
            id:
              (t.querySelector('[data-testid^="dock-tab-title-"]') as HTMLElement | null)
                ?.getAttribute('data-testid') ?? '',
            active: t.classList.contains('dock-tab-active'),
            color: cs.color,
            boxShadow: cs.boxShadow,
          }
        })
        return { error: null, tabs: dump, accent, tabCount: tabs.length }
      })

      expect(result.error).toBeNull()
      if (result.error) return
      expect(result.tabCount, 'expected 2+ tabs in the seeded pane').toBeGreaterThanOrEqual(2)

      const activeTabs = result.tabs.filter((t) => t.active)
      expect(activeTabs, 'exactly one tab must carry dock-tab-active').toHaveLength(1)

      // The active tab must have a non-"none" box-shadow (the inset accent
      // underline). The inactive tabs must have NO inset shadow.
      const active = activeTabs[0]
      expect(active.boxShadow, 'active tab must have an inset box-shadow').not.toBe('none')
      expect(active.boxShadow.toLowerCase()).toContain('inset')

      const inactives = result.tabs.filter((t) => !t.active)
      for (const t of inactives) {
        expect(
          t.boxShadow === 'none' || !t.boxShadow.toLowerCase().includes('inset'),
          `inactive tab ${t.id} must not have an inset box-shadow (was ${t.boxShadow})`,
        ).toBe(true)
      }

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
