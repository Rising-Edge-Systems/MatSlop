import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-033: Profiler panel.
 *
 * Covers:
 *  - Panel is hidden at startup (no profiler data).
 *  - Opening via the __matslopOpenProfiler hook mounts the panel with
 *    Start/Stop/Report buttons and an empty-state body.
 *  - Simulating a list of entries populates the report table with one
 *    row per function, showing the function name, time, and call count.
 *  - Column headers sort the table (clicking toggles direction).
 *  - Simulating an error surfaces the error branch and clears rows.
 *  - Closing via the hook unmounts the panel.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

interface ProfWindow extends Window {
  __matslopOpenProfiler?: () => void
  __matslopCloseProfiler?: () => void
  __matslopSimulateProfilerEntries?: (
    entries: Array<{ functionName: string; totalTime: number; numCalls: number }>,
  ) => void
  __matslopSimulateProfilerError?: (error: string) => void
  __matslopSimulateProfilerMode?: (mode: 'idle' | 'running' | 'stopped') => void
  __matslopProfilerState?: {
    mode: 'idle' | 'running' | 'stopped'
    entries: Array<{ functionName: string; totalTime: number; numCalls: number }>
    error: string | null
    open: boolean
  }
}

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test.beforeEach(async () => {
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopCloseProfiler?.()
    w.__matslopSimulateProfilerEntries?.([])
  })
})

test('profiler panel is hidden at startup', async () => {
  await expect(window.locator('[data-testid="profiler-panel"]')).toHaveCount(0)
})

test('opening via the hook mounts the panel with start/stop/report buttons', async () => {
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopOpenProfiler?.()
  })

  await expect(window.locator('[data-testid="profiler-panel"]')).toBeVisible()
  await expect(window.locator('[data-testid="profiler-start"]')).toBeVisible()
  await expect(window.locator('[data-testid="profiler-stop"]')).toBeVisible()
  await expect(window.locator('[data-testid="profiler-report"]')).toBeVisible()
  // Empty state: no rows yet.
  await expect(window.locator('[data-testid="profiler-empty"]')).toBeVisible()
  await expect(window.locator('[data-testid="profiler-row"]')).toHaveCount(0)
})

test('simulated entries populate the report table', async () => {
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopOpenProfiler?.()
    w.__matslopSimulateProfilerEntries?.([
      { functionName: 'main', totalTime: 0.5, numCalls: 1 },
      { functionName: 'helper', totalTime: 0.2, numCalls: 50 },
      { functionName: 'plot', totalTime: 0.05, numCalls: 3 },
    ])
  })

  const rows = window.locator('[data-testid="profiler-row"]')
  await expect(rows).toHaveCount(3)
  // Default sort: totalTime desc → main, helper, plot.
  await expect(rows.nth(0)).toHaveAttribute('data-function-name', 'main')
  await expect(rows.nth(1)).toHaveAttribute('data-function-name', 'helper')
  await expect(rows.nth(2)).toHaveAttribute('data-function-name', 'plot')

  // Time and call count cells render with their raw values in data-*.
  await expect(
    rows.nth(0).locator('[data-testid="profiler-cell-time"]'),
  ).toHaveAttribute('data-total-time', '0.5')
  await expect(
    rows.nth(0).locator('[data-testid="profiler-cell-calls"]'),
  ).toHaveAttribute('data-num-calls', '1')
})

test('clicking a column header re-sorts the table', async () => {
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopOpenProfiler?.()
    w.__matslopSimulateProfilerEntries?.([
      { functionName: 'aaa', totalTime: 0.5, numCalls: 1 },
      { functionName: 'zzz', totalTime: 0.1, numCalls: 99 },
    ])
  })

  // Sort by function name ascending.
  await window
    .locator('[data-testid="profiler-col-function"]')
    .dispatchEvent('click')
  let rows = window.locator('[data-testid="profiler-row"]')
  await expect(rows.nth(0)).toHaveAttribute('data-function-name', 'aaa')
  await expect(rows.nth(1)).toHaveAttribute('data-function-name', 'zzz')

  // Sort by calls (desc).
  await window
    .locator('[data-testid="profiler-col-calls"]')
    .dispatchEvent('click')
  rows = window.locator('[data-testid="profiler-row"]')
  await expect(rows.nth(0)).toHaveAttribute('data-function-name', 'zzz')
  await expect(rows.nth(1)).toHaveAttribute('data-function-name', 'aaa')
})

test('simulated error surfaces the error branch', async () => {
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopOpenProfiler?.()
    w.__matslopSimulateProfilerError?.('profiler was not started')
  })
  await expect(window.locator('[data-testid="profiler-error"]')).toContainText(
    'profiler was not started',
  )
  await expect(window.locator('[data-testid="profiler-row"]')).toHaveCount(0)
})

test('Start button is disabled while running, Stop enabled only then', async () => {
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopOpenProfiler?.()
  })
  // Idle: Start enabled, Stop disabled.
  await expect(window.locator('[data-testid="profiler-start"]')).toBeEnabled()
  await expect(window.locator('[data-testid="profiler-stop"]')).toBeDisabled()

  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopSimulateProfilerMode?.('running')
  })
  await expect(window.locator('[data-testid="profiler-start"]')).toBeDisabled()
  await expect(window.locator('[data-testid="profiler-stop"]')).toBeEnabled()
  await expect(window.locator('[data-testid="profiler-mode"]')).toHaveAttribute(
    'data-mode',
    'running',
  )
})

test('closing via the hook unmounts the panel', async () => {
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopOpenProfiler?.()
  })
  await expect(window.locator('[data-testid="profiler-panel"]')).toBeVisible()
  await window.evaluate(() => {
    const w = window as unknown as ProfWindow
    w.__matslopCloseProfiler?.()
  })
  await expect(window.locator('[data-testid="profiler-panel"]')).toHaveCount(0)
})
