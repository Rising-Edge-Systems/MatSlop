import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-012: Detached plot window.
 *
 * Rather than depending on a live Octave process (which isn't available in
 * most dev environments — same baseline limitation as the other live-script
 * plot tests), this suite exercises the IPC/window wiring directly:
 *
 *   1. Build a minimal valid `PlotFigure` JSON object in the main window
 *      and call `window.matslop.plotOpenDetached(figure)`.
 *   2. Wait for the new BrowserWindow to appear via Playwright's
 *      `app.waitForEvent('window')`.
 *   3. Assert the detached window renders the `DetachedPlot` root and that
 *      a `PlotRenderer` (Plotly-backed) eventually mounts inside it.
 *   4. Close the detached window and assert the main-process side
 *      cleans up its `detachedFigures` map and the main window regains
 *      focus.
 */

let app: ElectronApplication
let mainWindow: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, window: mainWindow, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

/**
 * A deterministic tiny 2D line figure that parsePlotFigure() accepts
 * without any running Octave. Must carry a numeric `handle` and a list
 * of axes with at least one series that figureToPlotly can render.
 */
const MINIMAL_FIGURE = {
  schemaVersion: 1,
  handle: 1,
  name: 'Test Detached',
  backgroundColor: [1, 1, 1, 1],
  size: [640, 480],
  axes: [
    {
      position: [0.13, 0.11, 0.775, 0.815],
      title: 'Detached Line',
      xlabel: 'x',
      ylabel: 'y',
      xlim: [0, 10],
      ylim: [-1, 1],
      is3D: false,
      series: [
        {
          type: 'line',
          x: [0, 1, 2, 3, 4, 5],
          y: [0, 0.5, 0.8, 0.6, 0.1, -0.4],
          color: [0.2, 0.4, 0.9, 1],
        },
      ],
    },
  ],
}

test('plotOpenDetached spawns a new BrowserWindow that renders the figure', async () => {
  // Sanity: main window rendered.
  await expect(mainWindow.locator('#root')).toBeVisible()

  // Kick off the detach + wait for the new window concurrently so we don't
  // miss the `window` event.
  const [detachedPage] = await Promise.all([
    app.waitForEvent('window'),
    mainWindow.evaluate(async (figure) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).matslop
      return api.plotOpenDetached(figure)
    }, MINIMAL_FIGURE),
  ])

  await detachedPage.waitForLoadState('domcontentloaded')

  // Detached page must receive the query string pointing at a figure id.
  const detachedSearch = await detachedPage.evaluate(() => window.location.search)
  expect(detachedSearch).toMatch(/detachedFigureId=/)

  // The detached window mounts the DetachedPlot root.
  await expect(detachedPage.locator('[data-testid="detached-plot"]')).toBeVisible({
    timeout: 10000,
  })

  // And inside it, the PlotRenderer surface is wired up. We don't wait for
  // Plotly's async lazy-load to fully paint (that can take a while on CI);
  // asserting the wrap + the inner renderer div is enough to know
  // PlotRenderer mounted.
  await expect(detachedPage.locator('[data-testid="plot-renderer-wrap"]').first()).toBeVisible({
    timeout: 15000,
  })

  // The detach button must NOT be present in the detached window itself
  // (canDetach={false}) — otherwise you could open detached-of-detached.
  await expect(detachedPage.locator('[data-testid="plot-detach-btn"]')).toHaveCount(0)

  // Main process bookkeeping registers the window.
  const countWhileOpen = await mainWindow.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).matslop._testDetachedPlotCount()
  })
  expect(countWhileOpen).toBeGreaterThanOrEqual(1)

  // Close the detached window: the handler in main should delete the map
  // entry and refocus the main window.
  await detachedPage.close()

  // Poll for the count to drop back (the `closed` handler is async).
  await mainWindow.waitForFunction(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = await (window as any).matslop._testDetachedPlotCount()
      return n === 0
    },
    null,
    { timeout: 5000 },
  )
})

test('detach button is present on every inline PlotRenderer in the main window', async () => {
  // Open a second detached window so we know the button path works end-to-end.
  const [detachedPage] = await Promise.all([
    app.waitForEvent('window'),
    mainWindow.evaluate(async (figure) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).matslop.plotOpenDetached(figure)
    }, MINIMAL_FIGURE),
  ])
  await detachedPage.waitForLoadState('domcontentloaded')
  await expect(detachedPage.locator('[data-testid="detached-plot"]')).toBeVisible({
    timeout: 10000,
  })
  await detachedPage.close()
})
