import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, waitForOctaveReady, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-009: Replace static PNG plots with interactive Plotly renderer in live
 * scripts. This suite opens fixture live scripts and verifies that after
 * execution, inline plot cells render through the interactive PlotRenderer
 * (marked with `data-testid="plot-renderer"` / `data-testid="ls-inline-plot"`)
 * and expose Plotly's built-in interactive modebar for rotate/zoom/pan/home.
 *
 * These tests require a working bundled/system Octave and the
 * `matslop_export_fig` helper on the Octave load path (addpath'd at
 * OctaveProcessManager startup). In dev environments without Octave they
 * fail during `waitForOctaveReady`, matching the baseline behavior of the
 * existing livescript-plots.spec.ts suite.
 */

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

test('quiver3 live script renders interactive Plotly canvases', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'quiver3.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="quiver3.mls"]')).toBeVisible()

  // Forward console logs for debugging.
  const consoleLogs: string[] = []
  window.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
  })

  // Run cell 1 (function defs) first, then cell 0 (the plotting cell).
  const runBtns = window.locator('.ls-cell-run-btn')
  await expect(runBtns).toHaveCount(2)
  await runBtns.nth(1).click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 30000 }
  )

  await runBtns.nth(0).click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 60000 }
  )

  // Allow Plotly to lazy-load and mount inside the cell outputs.
  await window.waitForTimeout(3000)

  // At least one interactive Plotly canvas should have rendered. Do not
  // assert on the exact count: matslop_export_fig downgrades unsupported
  // series to {type:'unknown'}, so the renderer may skip traces. We just
  // need the interactive pipeline (not the PNG fallback) to have fired.
  const interactivePlots = window.locator('[data-testid="ls-inline-plot"]')
  const plotRenderers = window.locator('[data-testid="plot-renderer"]')
  const interactiveCount = await interactivePlots.count()
  const rendererCount = await plotRenderers.count()
  console.log(`[test] interactive plot wrappers=${interactiveCount}, renderers=${rendererCount}`)
  for (const log of consoleLogs) console.log(`  ${log}`)

  expect(interactiveCount).toBeGreaterThan(0)
  expect(rendererCount).toBeGreaterThan(0)

  // Plotly mounts a .plotly div inside the renderer with built-in rotate/
  // zoom/pan/home controls (modebar buttons). Verify the modebar exists
  // and offers the "Reset" (home) button.
  const plotly = plotRenderers.first().locator('.js-plotly-plot')
  await expect(plotly).toBeVisible()

  // Modebar is lazily injected on first hover; force it to show by
  // dispatching mouseover and then querying for the reset button.
  await plotly.hover({ force: true })
  await window.waitForTimeout(300)
  const resetBtn = plotly.locator('[data-title*="Reset"], [data-title*="Home"]').first()
  await expect(resetBtn).toBeVisible({ timeout: 5000 })
})
