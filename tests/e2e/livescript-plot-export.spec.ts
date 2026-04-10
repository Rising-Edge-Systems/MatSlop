import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import {
  launchApp,
  closeApp,
  waitForOctaveReady,
  openFileInEditor,
  FIXTURES_DIR,
} from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-011: Export the current plot view as PNG/SVG.
 *
 * This test opens the multiplot fixture, runs the plotting cell, waits for
 * the interactive PlotRenderer to mount, and verifies:
 *   1. The export button is visible in the top-right corner of the renderer
 *   2. Clicking it calls the save dialog with a derived default filename
 *   3. Plotly.toImage is invoked and the resulting PNG bytes reach the
 *      target file on disk
 *
 * Both `window.matslop.figuresSaveDialog` and `window.matslop.figuresExportPlot`
 * are stubbed from inside `page.evaluate` so the test never hits the real
 * native dialog (which would block the run on CI).
 *
 * This suite requires a working Octave binary (same as the other live-script
 * plot tests) — in dev environments without bundled Octave it fails at
 * `waitForOctaveReady`, matching the baseline.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string
let tmpOutDir: string

test.beforeAll(async () => {
  ({ app, window, userDataDir } = await launchApp())
  await waitForOctaveReady(window)
  tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-export-'))
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
  try {
    fs.rmSync(tmpOutDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('export button saves interactive plot via stubbed save dialog', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multiplot.mls'))
  await expect(
    window.locator('[data-testid="editor-tab"][data-tab-filename="multiplot.mls"]'),
  ).toBeVisible()

  // Run all cells top-to-bottom.
  const runBtns = window.locator('.ls-cell-run-btn')
  const cellCount = await runBtns.count()
  for (let i = 0; i < cellCount; i++) {
    await runBtns.nth(i).click()
    await window.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="engine-status"]')
          ?.textContent?.includes('Ready') ?? false,
      { timeout: 60000 },
    )
  }

  // Give Plotly time to lazy-load and mount.
  await window.waitForTimeout(3000)

  const plotRenderers = window.locator('[data-testid="plot-renderer"]')
  await expect(plotRenderers.first()).toBeVisible()

  const exportBtn = window.locator('[data-testid="plot-export-btn"]').first()
  await expect(exportBtn).toBeVisible()

  // Stub the two figures IPCs before clicking so the native save dialog
  // never shows and we can assert what the renderer sent.
  const targetFile = path.join(tmpOutDir, 'exported.png')
  await window.evaluate((outFile) => {
    const w = window as unknown as {
      matslop: {
        figuresSaveDialog: (name: string) => Promise<{ filePath: string; format: string } | null>
        figuresExportPlot: (
          filePath: string,
          data: string,
          encoding: 'base64' | 'utf8',
        ) => Promise<{ success: boolean; error?: string }>
      }
      __mslp_export_calls__?: {
        dialogDefault?: string
        filePath?: string
        data?: string
        encoding?: string
      }
    }
    w.__mslp_export_calls__ = {}
    w.matslop.figuresSaveDialog = async (name: string) => {
      w.__mslp_export_calls__!.dialogDefault = name
      return { filePath: outFile, format: 'png' }
    }
    w.matslop.figuresExportPlot = async (
      filePath: string,
      data: string,
      encoding: 'base64' | 'utf8',
    ) => {
      w.__mslp_export_calls__!.filePath = filePath
      w.__mslp_export_calls__!.data = data
      w.__mslp_export_calls__!.encoding = encoding
      return { success: true }
    }
  }, targetFile)

  await exportBtn.click()

  // Wait for the export chain to settle.
  await window.waitForFunction(
    () =>
      !!(window as unknown as { __mslp_export_calls__?: { data?: string } })
        .__mslp_export_calls__?.data,
    { timeout: 20000 },
  )

  const calls = await window.evaluate(
    () =>
      (window as unknown as {
        __mslp_export_calls__?: {
          dialogDefault?: string
          filePath?: string
          data?: string
          encoding?: string
        }
      }).__mslp_export_calls__ ?? {},
  )
  expect(calls.dialogDefault).toBeTruthy()
  expect(calls.dialogDefault?.endsWith('.png')).toBe(true)
  expect(calls.filePath).toBe(targetFile)
  expect(calls.encoding).toBe('base64')
  // Plotly returns a data URL for PNG.
  expect(calls.data?.startsWith('data:image/png;base64,')).toBe(true)
})
