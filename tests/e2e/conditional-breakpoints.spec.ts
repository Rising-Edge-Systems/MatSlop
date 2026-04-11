import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-021: Conditional breakpoints.
 *
 * Drives the feature via the test-only `window.__matslopSetBreakpointCondition`
 * hook so the tests don't have to pixel-hunt a modal prompt. Asserts that:
 *   - The renderer's parallel condition store picks up the expression
 *   - The glyph margin decoration gains the `matslop-breakpoint-glyph-conditional`
 *     class (visual distinction)
 *   - The `debug:setBreakpointCondition` IPC handler responds success
 *   - Clearing the condition reverts to a plain breakpoint glyph
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('debug:setBreakpointCondition IPC responds successfully', async () => {
  const result = await window.evaluate(async () => {
    return await window.matslop.debugSetBreakpointCondition('/tmp/cond.m', 5, 'i > 10')
  })
  expect(result).toEqual({ success: true })

  const cleared = await window.evaluate(async () => {
    return await window.matslop.debugSetBreakpointCondition('/tmp/cond.m', 5, null)
  })
  expect(cleared).toEqual({ success: true })
})

test('setting a condition stores it in the renderer condition store', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'hello.m'))

  const tabLocator = window
    .locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]')
    .first()
  await expect(tabLocator).toBeVisible()
  const tabId = await tabLocator.getAttribute('data-tab-id')
  expect(tabId).toBeTruthy()

  // Use the test hook — this implicitly creates the breakpoint if needed
  // and then attaches the condition.
  await window.waitForFunction(
    (id) => {
      const w = window as unknown as {
        __matslopSetBreakpointCondition?: (
          tabId: string,
          line: number,
          condition: string | null,
        ) => void
      }
      if (!w.__matslopSetBreakpointCondition) return false
      w.__matslopSetBreakpointCondition(id, 2, 'i > 10')
      return true
    },
    tabId!,
    { timeout: 5000, polling: 100 },
  )

  // Wait until React has committed the new condition into the store.
  await window.waitForFunction(
    (id) => {
      const w = window as unknown as {
        __matslopBreakpointConditions?: Record<string, Record<number, string>>
      }
      const store = w.__matslopBreakpointConditions ?? {}
      return store[id]?.[2] === 'i > 10'
    },
    tabId!,
    { timeout: 5000, polling: 100 },
  )

  // And the breakpoint itself should be registered on line 2.
  const hasBp = await window.evaluate(
    (id) => {
      const w = window as unknown as {
        __matslopBreakpoints?: Record<string, number[]>
      }
      return (w.__matslopBreakpoints?.[id] ?? []).includes(2)
    },
    tabId!,
  )
  expect(hasBp).toBe(true)
})

test('conditional breakpoints render with the distinct glyph class', async () => {
  // The previous test set a conditional bp on line 2 — the glyph margin
  // should now contain at least one element with the conditional modifier.
  await expect(
    window.locator('.matslop-breakpoint-glyph-conditional').first(),
  ).toBeVisible()
})

test('clearing the condition reverts to a plain breakpoint glyph', async () => {
  const tabLocator = window
    .locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]')
    .first()
  const tabId = await tabLocator.getAttribute('data-tab-id')

  await window.evaluate(
    (id) => {
      const w = window as unknown as {
        __matslopSetBreakpointCondition?: (
          tabId: string,
          line: number,
          condition: string | null,
        ) => void
      }
      w.__matslopSetBreakpointCondition?.(id, 2, null)
    },
    tabId!,
  )

  await window.waitForFunction(
    (id) => {
      const w = window as unknown as {
        __matslopBreakpointConditions?: Record<string, Record<number, string>>
      }
      const forTab = w.__matslopBreakpointConditions?.[id]
      return !forTab || !(2 in forTab)
    },
    tabId!,
    { timeout: 5000, polling: 100 },
  )

  // Conditional glyph should be gone; the plain red-circle glyph remains.
  await expect(
    window.locator('.matslop-breakpoint-glyph-conditional'),
  ).toHaveCount(0)
  await expect(
    window.locator('.matslop-breakpoint-glyph').first(),
  ).toBeVisible()
})
