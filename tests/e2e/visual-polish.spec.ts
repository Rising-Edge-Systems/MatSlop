import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

/**
 * US-P10: Visual-regression spec for the polished MatSlop layout.
 *
 * Launches the app, resizes the BrowserWindow to a fixed 1600x1000, waits
 * for the dock to settle, screenshots the full page, and asserts:
 *   1. No contiguous near-white region (#f3f3f3 or #ffffff) larger than
 *      100x100 pixels exists inside the dock area (catches rc-dock light
 *      theme leaks - see US-P03).
 *   2. Every `[data-testid^="dock-tab-"]` element fills its parent dock
 *      panel content area within a 4px tolerance on all four sides
 *      (catches collapsed-panel regressions - see US-P02 / US-P08).
 *
 * A baseline PNG of the screenshot is committed under
 * tests/e2e/__screenshots__/visual-polish/ for human inspection. The
 * pixel asserts above are the actual regression gates; the baseline
 * exists for human review only and is regenerated whenever it is missing.
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.join(__dirname, '__screenshots__', 'visual-polish')
const BASELINE_PATH = path.join(SCREENSHOT_DIR, 'default-layout-1600x1000.png')

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())

  // Resize the Electron BrowserWindow to a deterministic size in the
  // main process. Page.setViewportSize is a no-op for Electron windows.
  await app.evaluate(async ({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows()
    const main = wins.find((w) => w.getTitle() === 'MatSlop') ?? wins[0]
    if (!main) return
    if (main.isMaximized()) main.unmaximize()
    main.setBounds({ x: 50, y: 50, width: 1600, height: 1000 })
  })

  // Wait for the dock to mount and idle (panels visible, layout settled).
  await window.locator('[data-testid="matslop-dock-layout"]').waitFor({ state: 'visible' })
  await window.locator('[data-testid="file-browser"]').waitFor({ state: 'visible' })
  await window.locator('[data-testid="editor-panel"]').waitFor({ state: 'visible' })
  await window.locator('[data-testid="command-window"]').waitFor({ state: 'visible' })
  await window.locator('[data-testid="workspace-panel"]').waitFor({ state: 'visible' })

  // Allow rc-dock's flex layout + Monaco's automaticLayout to settle.
  await window.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  )
  await window.waitForTimeout(250)
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('Default layout has no light-theme leaks larger than 100x100 inside dock', async () => {
  const dock = window.locator('[data-testid="matslop-dock-layout"]')
  await expect(dock).toBeVisible()
  const dockBox = await dock.boundingBox()
  expect(dockBox).toBeTruthy()
  if (!dockBox) return

  // Capture a fullPage screenshot once for both human review and pixel asserts.
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const screenshot = await window.screenshot({ fullPage: true })
  if (!fs.existsSync(BASELINE_PATH)) {
    fs.writeFileSync(BASELINE_PATH, screenshot)
  }

  // Pixel-scan the dock area for contiguous near-white blocks. We sample
  // a 4px grid for speed and look for any 100x100 region whose grid
  // samples are all near-white.
  type Sample = { white: boolean; x: number; y: number }
  const samples: Sample[] = await window.evaluate(
    async ({ box }) => {
      const dockEl = document.querySelector('[data-testid="matslop-dock-layout"]') as HTMLElement
      if (!dockEl) return []
      const rect = dockEl.getBoundingClientRect()

      // Use html2canvas-style readback via canvas+drawWindow is unavailable
      // in Electron renderer. Instead we walk the DOM and synthesise a
      // light-pixel grid from element backgrounds. This is good enough to
      // catch rc-dock default light chrome leaks because rc-dock paints
      // solid background colors on its .dock-bar / .dock-panel children.
      const step = 8
      const out: { white: boolean; x: number; y: number }[] = []
      for (let y = rect.top; y < rect.bottom; y += step) {
        for (let x = rect.left; x < rect.right; x += step) {
          const el = document.elementFromPoint(x, y) as HTMLElement | null
          if (!el) {
            out.push({ white: false, x, y })
            continue
          }
          // Walk up the parent chain until we hit an element with an
          // explicit background color (default rgba(0,0,0,0) is "inherit").
          let bg = ''
          let cur: HTMLElement | null = el
          while (cur && cur !== document.body) {
            const c = getComputedStyle(cur).backgroundColor
            if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
              bg = c
              break
            }
            cur = cur.parentElement
          }
          // Parse rgb(a)
          const m = /rgba?\(([^)]+)\)/.exec(bg)
          let white = false
          if (m) {
            const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
            const [r, g, b] = parts
            // Near-white = all channels >= 235
            white = r >= 235 && g >= 235 && b >= 235
          }
          out.push({ white, x, y })
        }
      }
      return out
    },
    { box: dockBox },
  )

  // Find any 100x100 axis-aligned rectangle whose samples are all white.
  // Step is 8px so a 100x100 region covers a 12x12 sample window.
  const step = 8
  const need = Math.ceil(100 / step) // 13
  const byKey = new Map<string, boolean>()
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const s of samples) {
    byKey.set(`${s.x}|${s.y}`, s.white)
    if (s.x < minX) minX = s.x
    if (s.y < minY) minY = s.y
    if (s.x > maxX) maxX = s.x
    if (s.y > maxY) maxY = s.y
  }
  let leak: { x: number; y: number } | null = null
  for (let y = minY; y + need * step <= maxY && !leak; y += step) {
    for (let x = minX; x + need * step <= maxX && !leak; x += step) {
      let allWhite = true
      for (let dy = 0; dy < need && allWhite; dy++) {
        for (let dx = 0; dx < need && allWhite; dx++) {
          if (!byKey.get(`${x + dx * step}|${y + dy * step}`)) allWhite = false
        }
      }
      if (allWhite) leak = { x, y }
    }
  }
  expect(leak, `near-white 100x100 leak detected at ${JSON.stringify(leak)}`).toBeNull()
})

test('US-Q03: panel content fills its parent and the command prompt anchors at bottom', async () => {
  // .fb-content and .ws-content must fill the panel root horizontally so
  // there is no gray strip on the right edge.
  const fbContent = window.locator('[data-testid="file-browser"] .fb-content').first()
  const wsContent = window.locator('[data-testid="workspace-panel"] .ws-content').first()
  await expect(fbContent).toBeVisible()
  await expect(wsContent).toBeVisible()

  const fbWidths = await fbContent.evaluate((el) => {
    const root = el.closest('.panel') as HTMLElement | null
    if (!root) return null
    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return { content: a.width, root: b.width }
  })
  expect(fbWidths, 'fb-content must have a .panel ancestor').not.toBeNull()
  if (fbWidths) {
    expect(
      Math.abs(fbWidths.content - fbWidths.root),
      `fb-content width (${fbWidths.content}) should equal panel root width (${fbWidths.root}) within 1px`,
    ).toBeLessThanOrEqual(1)
  }

  const wsWidths = await wsContent.evaluate((el) => {
    const root = el.closest('.panel') as HTMLElement | null
    if (!root) return null
    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return { content: a.width, root: b.width }
  })
  expect(wsWidths, 'ws-content must have a .panel ancestor').not.toBeNull()
  if (wsWidths) {
    expect(
      Math.abs(wsWidths.content - wsWidths.root),
      `ws-content width (${wsWidths.content}) should equal panel root width (${wsWidths.root}) within 1px`,
    ).toBeLessThanOrEqual(1)
  }

  // The Command Window prompt must be anchored at the bottom of the
  // .cw-output scroll region (no dead space below it). With a fresh
  // session there is little/no scrollback, so the input line bottom
  // should sit very close to the cw-output bottom edge.
  const cwBox = await window.evaluate(() => {
    const out = document.querySelector(
      '[data-testid="command-window"] .cw-output',
    ) as HTMLElement | null
    const line = document.querySelector(
      '[data-testid="command-window"] .cw-input-line',
    ) as HTMLElement | null
    if (!out || !line) return null
    const o = out.getBoundingClientRect()
    const l = line.getBoundingClientRect()
    return { outBottom: o.bottom, lineBottom: l.bottom, outHeight: o.height }
  })
  expect(cwBox, 'cw-output and cw-input-line must exist').not.toBeNull()
  if (cwBox) {
    // Allow up to ~16px bottom padding/margin.
    expect(
      cwBox.outBottom - cwBox.lineBottom,
      `cw-input-line bottom must sit within 16px of cw-output bottom (out=${cwBox.outBottom}, line=${cwBox.lineBottom}, height=${cwBox.outHeight})`,
    ).toBeLessThanOrEqual(16)
  }
})

test('US-R02: workspace placeholder text is fully visible at 1600x1000', async () => {
  // "No variables in workspace" must render without horizontal clipping
  // inside the Workspace pane. The pane has a minWidth of 200px so the
  // text fits comfortably on a single line or wraps cleanly to a second.
  const placeholder = window
    .locator('[data-testid="workspace-panel"] .placeholder-text')
    .first()
  await expect(placeholder).toBeVisible()
  const metrics = await placeholder.evaluate((el) => {
    const p = el as HTMLElement
    const host = p.closest('.panel') as HTMLElement | null
    const r = p.getBoundingClientRect()
    const h = host?.getBoundingClientRect()
    return {
      scrollWidth: p.scrollWidth,
      clientWidth: p.clientWidth,
      text: (p.textContent ?? '').trim(),
      right: r.right,
      panelRight: h?.right ?? 0,
    }
  })
  // Placeholder must contain one of the expected strings (depends on Octave
  // availability in the test environment — both are valid ws placeholder states).
  expect(['No variables in workspace', 'Octave not connected']).toContain(metrics.text)
  // No horizontal overflow (wrap handles the narrow case; at 1600x1000
  // the right column is ~320px which fits the text on one line).
  expect(
    metrics.scrollWidth - metrics.clientWidth,
    `placeholder horizontal overflow: scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(1)
  // Bounding rect must stay inside the owning panel.
  expect(
    metrics.right,
    `placeholder right edge (${metrics.right}) exceeds panel right (${metrics.panelRight})`,
  ).toBeLessThanOrEqual(metrics.panelRight + 1)
})

test('Every dock tab fills its parent rc-dock panel content area', async () => {
  const tabs = await window.locator('[data-testid^="dock-tab-"]').all()
  // Filter out the dock-tab-title-* spans (they share the prefix).
  const contentTabs = []
  for (const t of tabs) {
    const id = await t.getAttribute('data-testid')
    if (id && !id.startsWith('dock-tab-title-') && id !== 'dock-tab-context-menu' && id !== 'dock-tab-context-menu-detach' && id !== 'dock-tab-missing') {
      contentTabs.push(t)
    }
  }
  expect(contentTabs.length, 'expected at least 4 dock tabs in default layout').toBeGreaterThanOrEqual(4)

  for (const tab of contentTabs) {
    const id = await tab.getAttribute('data-testid')
    const tabBox = await tab.boundingBox()
    if (!tabBox) continue
    // Ascend to the nearest rc-dock pane content (.dock-content). That is
    // the area rc-dock allots to the tab body, excluding the tab strip.
    const parentBox = await tab.evaluate((el) => {
      let p: HTMLElement | null = el.parentElement
      while (p && !p.classList.contains('dock-content') && !p.classList.contains('dock-content-holder')) {
        p = p.parentElement
      }
      if (!p) return null
      const r = p.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    expect(parentBox, `tab ${id} has no .dock-content ancestor`).toBeTruthy()
    if (!parentBox) continue
    const tol = 4
    expect(Math.abs(tabBox.x - parentBox.x), `tab ${id} x mismatch`).toBeLessThanOrEqual(tol)
    expect(Math.abs(tabBox.y - parentBox.y), `tab ${id} y mismatch`).toBeLessThanOrEqual(tol)
    expect(
      Math.abs(tabBox.x + tabBox.width - (parentBox.x + parentBox.width)),
      `tab ${id} right edge mismatch`,
    ).toBeLessThanOrEqual(tol)
    expect(
      Math.abs(tabBox.y + tabBox.height - (parentBox.y + parentBox.height)),
      `tab ${id} bottom edge mismatch`,
    ).toBeLessThanOrEqual(tol)
  }
})
