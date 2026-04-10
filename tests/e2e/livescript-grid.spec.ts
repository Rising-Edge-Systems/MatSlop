import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, waitForOctaveReady, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-004: Refactor live script to CSS grid with global code and output tracks.
 *
 * Verifies:
 *   - .ls-cells is a CSS grid with 2 columns
 *   - Each code cell produces paired code / output grid children
 *   - Output is NOT nested inside the code-side cell container
 *   - Hovering a cell highlights both halves (code + output)
 *   - Existing multiplot fixture still renders.
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

test('live-script cells container uses a 2-column CSS grid', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const container = window.locator('[data-testid="ls-cells"]')
  await expect(container).toBeVisible()

  // The grid container uses display: grid and has exactly 2 template columns.
  const info = await container.evaluate((el) => {
    const cs = window.getComputedStyle(el)
    return {
      display: cs.display,
      templateColumns: cs.gridTemplateColumns,
    }
  })
  expect(info.display).toBe('grid')
  // grid-template-columns resolves to two track sizes (two values separated by whitespace)
  const tracks = info.templateColumns.trim().split(/\s+/)
  expect(tracks.length).toBe(2)
})

test('each code cell has a paired output grid sibling and outputs live outside the code container', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  // For every code cell there must be a sibling output grid item with the same data-cell-id
  const pairs = await window.evaluate(() => {
    const codeSides = Array.from(document.querySelectorAll('[data-testid="ls-cell"][data-cell-type="code"]')) as HTMLElement[]
    return codeSides.map((code) => {
      const cellId = code.dataset.cellId
      const outputSibling = document.querySelector(`[data-testid="ls-cell-output"][data-cell-id="${cellId}"]`) as HTMLElement | null
      const outputIsNestedInside = !!(outputSibling && code.contains(outputSibling))
      // The output should share the same parent as the code side (the grid container)
      const sharedParent = !!(outputSibling && outputSibling.parentElement === code.parentElement)
      return {
        cellId,
        hasOutput: !!outputSibling,
        outputIsNestedInside,
        sharedParent,
      }
    })
  })
  expect(pairs.length).toBeGreaterThan(0)
  for (const p of pairs) {
    expect(p.hasOutput, `cell ${p.cellId} missing output sibling`).toBe(true)
    expect(p.outputIsNestedInside, `cell ${p.cellId} output is nested inside code container`).toBe(false)
    expect(p.sharedParent, `cell ${p.cellId} output does not share grid parent with code`).toBe(true)
  }
})

test('code and output siblings share the same vertical grid row (top aligned)', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const pairs = await window.evaluate(() => {
    const codeSides = Array.from(document.querySelectorAll('[data-testid="ls-cell"][data-cell-type="code"]')) as HTMLElement[]
    return codeSides.map((code) => {
      const cellId = code.dataset.cellId
      const output = document.querySelector(`[data-testid="ls-cell-output"][data-cell-id="${cellId}"]`) as HTMLElement | null
      const cr = code.getBoundingClientRect()
      const or = output?.getBoundingClientRect() ?? null
      return {
        cellId,
        codeTop: cr.top,
        outputTop: or?.top ?? null,
        codeLeft: cr.left,
        outputLeft: or?.left ?? null,
        codeRight: cr.right,
      }
    })
  })
  for (const p of pairs) {
    expect(p.outputTop).not.toBeNull()
    // Both halves share the same grid-row so their tops should match (within sub-pixel jitter)
    expect(Math.abs((p.outputTop as number) - p.codeTop)).toBeLessThan(2)
    // Output sits to the right of code
    expect(p.outputLeft as number).toBeGreaterThanOrEqual(p.codeRight - 2)
  }
})

test('hovering a cell applies the highlight class to both code and output sides', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const firstCode = window.locator('[data-testid="ls-cell"][data-cell-type="code"]').first()
  await firstCode.hover()
  // Wait a tick for React state to flush
  await window.waitForTimeout(50)

  const state = await window.evaluate(() => {
    const code = document.querySelector('[data-testid="ls-cell"][data-cell-type="code"]') as HTMLElement | null
    if (!code) return null
    const cellId = code.dataset.cellId
    const output = document.querySelector(`[data-testid="ls-cell-output"][data-cell-id="${cellId}"]`) as HTMLElement | null
    return {
      codeHover: code.classList.contains('ls-cell-hover'),
      outputHover: !!output?.classList.contains('ls-cell-hover'),
    }
  })
  expect(state).not.toBeNull()
  expect(state!.codeHover).toBe(true)
  expect(state!.outputHover).toBe(true)
})

test('multiplot fixture still renders 4 plots in the new grid layout', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multiplot.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multiplot.mls"]')).toBeVisible()

  const runBtn = window.locator('.ls-cell-run-btn').first()
  await expect(runBtn).toBeVisible()
  await runBtn.click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="engine-status"]')?.textContent?.includes('Ready') ?? false,
    { timeout: 30000 }
  )
  await window.waitForTimeout(1500)

  const plotImages = window.locator('.ls-interactive-plot-image')
  const plotCount = await plotImages.count()
  expect(plotCount).toBe(4)
})
