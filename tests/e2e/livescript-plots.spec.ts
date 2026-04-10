import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, waitForOctaveReady, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
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

test('multi-plot live script renders all plots after running', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multiplot.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multiplot.mls"]')).toBeVisible()

  // Capture console logs from the renderer for debugging
  const consoleLogs: string[] = []
  window.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
  })

  // Click the Run Cell button for the first code cell
  const runBtn = window.locator('.ls-cell-run-btn').first()
  await expect(runBtn).toBeVisible()
  await runBtn.click()

  // Wait for engine to return to ready
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 30000 }
  )

  // Wait a moment for the cell UI to update after execution
  await window.waitForTimeout(1500)

  // Query for inline plot images
  const plotImages = window.locator('.ls-interactive-plot-image')
  const plotCount = await plotImages.count()

  // Log what we see for debugging
  console.log(`[test] Found ${plotCount} inline plot images`)
  console.log(`[test] Renderer console logs:`)
  for (const log of consoleLogs) console.log(`  ${log}`)

  // Grab the cell output area HTML for inspection
  const outputColHTML = await window.locator('.ls-cell-output-col').first().innerHTML()
  console.log(`[test] Output column HTML length: ${outputColHTML.length}`)
  if (outputColHTML.length < 2000) {
    console.log(`[test] Output column HTML: ${outputColHTML}`)
  }

  // We expect exactly 4 plots from 4 plot() calls with intervening title() calls
  expect(plotCount).toBe(4)

  // Each plot should have a valid base64 data URL
  for (let i = 0; i < plotCount; i++) {
    const src = await plotImages.nth(i).getAttribute('src')
    expect(src).toMatch(/^data:image\/png;base64,/)
    expect((src ?? '').length).toBeGreaterThan(1000)
  }
})

test('quiver3 vector field script renders 4 plots (regression: plot-creator regex)', async () => {
  // Fixture mirrors a real user script: cell 0 calls quiver3 using helper
  // functions; cell 1 defines those functions. quiver3 was missing from the
  // plot-creator regex originally, causing no plots to be captured.
  // We must run cell 1 (function defs) BEFORE cell 0 (usage) because Octave
  // interactive mode doesn't forward-declare.
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'quiver3.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="quiver3.mls"]')).toBeVisible()

  // Run cell 1 (function definitions) first
  const runBtns = window.locator('.ls-cell-run-btn')
  await expect(runBtns).toHaveCount(2)
  await runBtns.nth(1).click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 30000 }
  )

  // Now run cell 0 (the plotting cell)
  await runBtns.nth(0).click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 60000 }
  )
  await window.waitForTimeout(2000)

  const plotImages = window.locator('.ls-interactive-plot-image')
  const plotCount = await plotImages.count()
  console.log(`[test] quiver3: Found ${plotCount} inline plot images`)

  // Also capture any error output for debugging
  const errorOutputs = await window.locator('.ls-cell-output-error pre').allTextContents()
  if (errorOutputs.length > 0) {
    console.log(`[test] error outputs:`, errorOutputs)
  }

  expect(plotCount).toBe(4)
})

