import { test, expect } from '@playwright/test'
import path from 'path'
import {
  launchApp,
  closeApp,
  waitForOctaveReady,
  openFileInEditor,
  FIXTURES_DIR,
} from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-010: Data cursor / tooltip on plot points.
 *
 * Verifies:
 *  - Layout configured with hovermode=closest (so hovering shows a tooltip)
 *  - `plotly_click` pins an annotation on the clicked point
 *  - `plotly_doubleclick` clears pinned annotations
 *
 * We simulate the click via Plotly's JS API (`_doClick`) rather than a real
 * pointer event so the test doesn't flake on pixel-perfect coordinate math.
 * The annotations list after a click MUST contain a new entry compared to
 * before the click — that's the pin behaviour. After a clearAnnotations
 * relayout the list empties, proving the double-click path works.
 *
 * Requires a working bundled/system Octave, same as the other livescript
 * plot specs.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())
  await waitForOctaveReady(window)
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('2D plot pins a data-cursor annotation on click and clears on double-click', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multiplot.mls'))
  await expect(
    window.locator('[data-testid="editor-tab"][data-tab-filename="multiplot.mls"]'),
  ).toBeVisible()

  const runBtns = window.locator('.ls-cell-run-btn')
  await expect(runBtns).toHaveCount(1)
  await runBtns.nth(0).click()
  await window.waitForFunction(
    () =>
      document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ??
      false,
    { timeout: 60000 },
  )

  // Give Plotly a moment to mount inside the cell output.
  await window.waitForTimeout(3000)

  const plotRenderers = window.locator('[data-testid="plot-renderer"]')
  await expect(plotRenderers.first()).toBeVisible({ timeout: 10000 })

  // Sanity: Plotly layout has hovermode: 'closest'.
  const hovermode = await plotRenderers.first().evaluate((el: Element) => {
    const pd = el as HTMLElement & { layout?: { hovermode?: string } }
    return pd.layout?.hovermode ?? null
  })
  expect(hovermode).toBe('closest')

  // Before-state: count annotations on the first plot.
  const before = await plotRenderers.first().evaluate((el: Element) => {
    const pd = el as HTMLElement & { layout?: { annotations?: unknown[] } }
    return (pd.layout?.annotations ?? []).length
  })

  // Programmatically fire plotly_click with a synthetic event. We do this by
  // calling the handler Plotly exposes on the div — equivalent to the user
  // clicking the first data point — then triggering a relayout.
  await plotRenderers.first().evaluate(async (el: Element) => {
    const pd = el as HTMLElement & {
      data?: Array<{ x?: number[]; y?: number[]; type?: string }>
      _fullData?: unknown[]
      emit?: (name: string, payload: unknown) => void
    }
    const trace = pd.data?.[0]
    if (!trace || !trace.x || !trace.y) throw new Error('plot has no traces')
    const idx = Math.floor(trace.x.length / 2)
    const fakeEvent = {
      points: [
        {
          x: trace.x[idx],
          y: trace.y[idx],
          data: { type: trace.type ?? 'scatter' },
          xaxis: { _name: 'x' },
          yaxis: { _name: 'y' },
        },
      ],
    }
    // Plotly dispatches custom events via .emit() on the div.
    pd.emit?.('plotly_click', fakeEvent)
    // Give relayout a tick to apply.
    await new Promise((r) => setTimeout(r, 200))
  })

  const after = await plotRenderers.first().evaluate((el: Element) => {
    const pd = el as HTMLElement & { layout?: { annotations?: unknown[] } }
    return (pd.layout?.annotations ?? []).length
  })
  expect(after).toBe(before + 1)

  // Verify the pinned annotation text contains "x:" and "y:" (our
  // formatCursorLabel output).
  const annotationText = await plotRenderers.first().evaluate((el: Element) => {
    const pd = el as HTMLElement & { layout?: { annotations?: Array<{ text?: string }> } }
    const list = pd.layout?.annotations ?? []
    return list[list.length - 1]?.text ?? null
  })
  expect(annotationText).toBeTruthy()
  expect(annotationText).toContain('x:')
  expect(annotationText).toContain('y:')

  // Now emit plotly_doubleclick and verify the annotations list empties.
  await plotRenderers.first().evaluate(async (el: Element) => {
    const pd = el as HTMLElement & { emit?: (name: string, payload: unknown) => void }
    pd.emit?.('plotly_doubleclick', {})
    await new Promise((r) => setTimeout(r, 200))
  })

  const cleared = await plotRenderers.first().evaluate((el: Element) => {
    const pd = el as HTMLElement & { layout?: { annotations?: unknown[] } }
    return (pd.layout?.annotations ?? []).length
  })
  expect(cleared).toBe(0)
})
