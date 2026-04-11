import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-022: Watch expressions panel.
 *
 * Verifies:
 *   - Panel is hidden at startup (no watches, not paused).
 *   - Adding a watch via the test hook mounts the panel and shows the row.
 *   - Simulating a value update populates the row's value cell.
 *   - Simulating an evaluation error surfaces the error branch.
 *   - Updating and removing watches via the test hooks mutate the list.
 *   - Pause state alone mounts the panel (so users can add watches mid-pause).
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

interface WatchWindow extends Window {
  __matslopAddWatch?: (expression: string) => void
  __matslopRemoveWatch?: (id: string) => void
  __matslopUpdateWatch?: (id: string, expression: string) => void
  __matslopClearWatches?: () => void
  __matslopSimulateWatchValue?: (id: string, value: string) => void
  __matslopSimulateWatchError?: (id: string, error: string) => void
  __matslopSimulatePaused?: (file: string, line: number) => void
  __matslopClearPaused?: () => void
  __matslopWatches?: Array<{
    id: string
    expression: string
    value: string | null
    error: string | null
  }>
}

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test.beforeEach(async () => {
  await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    w.__matslopClearWatches?.()
    w.__matslopClearPaused?.()
  })
})

test('watches panel is hidden when no watches and not paused', async () => {
  await expect(window.locator('[data-testid="watches-panel"]')).toHaveCount(0)
})

test('adding a watch mounts the panel and shows the row', async () => {
  await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    w.__matslopAddWatch?.('length(data)')
  })

  await expect(window.locator('[data-testid="watches-panel"]')).toBeVisible()
  const row = window.locator('[data-testid="watches-row"]').first()
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('data-watch-expression', 'length(data)')
  // No value yet → pending placeholder.
  await expect(row.locator('[data-testid="watches-value"]')).toBeVisible()
})

test('simulated value populates the row', async () => {
  await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    w.__matslopAddWatch?.('x')
  })
  // Grab the freshly-minted id from the exposed watches mirror.
  const id = await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    return w.__matslopWatches?.[0]?.id ?? null
  })
  expect(id).not.toBeNull()

  await window.evaluate((watchId) => {
    const w = window as unknown as WatchWindow
    w.__matslopSimulateWatchValue?.(watchId as string, '42')
  }, id)

  const row = window.locator('[data-testid="watches-row"]').first()
  await expect(row.locator('[data-testid="watches-value"]')).toContainText('42')
})

test('simulated error shows the error branch', async () => {
  await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    w.__matslopAddWatch?.('nope')
  })
  const id = await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    return w.__matslopWatches?.[0]?.id ?? null
  })

  await window.evaluate((watchId) => {
    const w = window as unknown as WatchWindow
    w.__matslopSimulateWatchError?.(watchId as string, "'nope' undefined")
  }, id)

  const row = window.locator('[data-testid="watches-row"]').first()
  await expect(row).toHaveClass(/watches-row-error/)
  await expect(row.locator('[data-testid="watches-value"]')).toContainText("'nope' undefined")
})

test('updating and removing watches via hooks mutates the list', async () => {
  await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    w.__matslopAddWatch?.('a')
    w.__matslopAddWatch?.('b')
  })
  await expect(window.locator('[data-testid="watches-row"]')).toHaveCount(2)

  const firstId = await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    return w.__matslopWatches?.[0]?.id ?? null
  })

  // Rename 'a' → 'a + 1'
  await window.evaluate((id) => {
    const w = window as unknown as WatchWindow
    w.__matslopUpdateWatch?.(id as string, 'a + 1')
  }, firstId)
  await expect(
    window.locator('[data-testid="watches-row"]').first(),
  ).toHaveAttribute('data-watch-expression', 'a + 1')

  // Remove the renamed row
  await window.evaluate((id) => {
    const w = window as unknown as WatchWindow
    w.__matslopRemoveWatch?.(id as string)
  }, firstId)
  await expect(window.locator('[data-testid="watches-row"]')).toHaveCount(1)
  await expect(
    window.locator('[data-testid="watches-row"]').first(),
  ).toHaveAttribute('data-watch-expression', 'b')
})

test('panel mounts during a pause even with no watches yet', async () => {
  await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    w.__matslopSimulatePaused?.('/tmp/script.m', 10)
  })
  await expect(window.locator('[data-testid="watches-panel"]')).toBeVisible()
  // Empty state message should be visible.
  await expect(window.locator('[data-testid="watches-empty"]')).toBeVisible()
})

test('add-button is disabled when input is empty', async () => {
  // Need a watch to mount the panel first.
  await window.evaluate(() => {
    const w = window as unknown as WatchWindow
    w.__matslopAddWatch?.('seed')
  })
  const addBtn = window.locator('[data-testid="watches-add-btn"]')
  await expect(addBtn).toBeDisabled()

  // Typing enables it.
  await window.locator('[data-testid="watches-add-input"]').fill('x+y')
  await expect(addBtn).toBeEnabled()
})
