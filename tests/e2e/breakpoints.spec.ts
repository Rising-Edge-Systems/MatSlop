import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-014: Breakpoint gutter end-to-end tests.
 *
 * Drives the breakpoint toggle via the test-only `window.__matslopToggleBreakpoint`
 * hook rather than pixel-hunting Monaco's glyph margin — Monaco's DOM is built
 * lazily and is flaky under Playwright click APIs.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  // Breakpoint gutter UI is renderer-only and doesn't depend on a running
  // Octave process — skip waitForOctaveReady so this suite passes in dev
  // environments that don't have a bundled Octave binary.
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('glyph margin is enabled on the active .m editor', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'hello.m'))
  // Monaco renders its glyph margin as .glyph-margin — wait for it to appear.
  await expect(window.locator('.monaco-editor .glyph-margin').first()).toBeVisible()
})

test('toggling a breakpoint adds it to the tab-level store', async () => {
  // Read the first non-welcome editor tab id from the DOM. (Using `.active`
  // can be flaky when the no-Octave modal obscures focus state in dev
  // environments; the tab element itself is still rendered.)
  const tabLocator = window
    .locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]')
    .first()
  await expect(tabLocator).toBeVisible()
  const activeTabId = await tabLocator.getAttribute('data-tab-id')
  expect(activeTabId).toBeTruthy()

  // Toggle line 3 on via the exposed test hook.
  await window.evaluate((tabId) => {
    const w = window as unknown as {
      __matslopToggleBreakpoint?: (tabId: string, line: number) => void
    }
    if (!w.__matslopToggleBreakpoint) throw new Error('toggle hook missing')
    w.__matslopToggleBreakpoint(tabId, 3)
  }, activeTabId!)

  // Poll the test-exposed global until React flushes the state. We retry the
  // toggle itself in case the component just remounted (tabsRef ref hadn't
  // populated yet, causing the first call to no-op).
  await window.waitForFunction(
    (tabId) => {
      const w = window as unknown as {
        __matslopBreakpoints?: Record<string, number[]>
        __matslopToggleBreakpoint?: (tabId: string, line: number) => void
      }
      const lines = w.__matslopBreakpoints?.[tabId] ?? []
      if (lines.includes(3)) return true
      w.__matslopToggleBreakpoint?.(tabId, 3)
      return false
    },
    activeTabId!,
    { timeout: 5000, polling: 100 },
  )
})

test('debug:setBreakpoint IPC handler responds successfully', async () => {
  // The renderer's toggle handler fires this IPC, but contextBridge-exposed
  // objects are frozen so we can't stub them. Instead, assert the IPC
  // contract directly by invoking it from the renderer and checking the
  // main-process handler returns { success: true }.
  const result = await window.evaluate(async () => {
    return await window.matslop.debugSetBreakpoint('/tmp/ipc-test.m', 42)
  })
  expect(result).toEqual({ success: true })

  const clearResult = await window.evaluate(async () => {
    return await window.matslop.debugClearBreakpoint('/tmp/ipc-test.m', 42)
  })
  expect(clearResult).toEqual({ success: true })
})

test('breakpoint decoration is rendered in the glyph margin', async () => {
  // After the previous test set line 3, Monaco should have emitted our
  // custom .matslop-breakpoint-glyph element into the glyph margin.
  await expect(window.locator('.matslop-breakpoint-glyph').first()).toBeVisible()
})

test('toggling the same line clears the breakpoint', async () => {
  // Toggle off: find the live tab id with a breakpoint and toggle line 3 again.
  await window.evaluate(() => {
    const w = window as unknown as {
      __matslopBreakpoints?: Record<string, number[]>
      __matslopToggleBreakpoint?: (tabId: string, line: number) => void
    }
    const store = w.__matslopBreakpoints ?? {}
    for (const [tabId, lines] of Object.entries(store)) {
      if (lines.includes(3)) {
        w.__matslopToggleBreakpoint?.(tabId, 3)
        break
      }
    }
  })

  const store = await window.evaluate(() => {
    const w = window as unknown as { __matslopBreakpoints?: Record<string, number[]> }
    return w.__matslopBreakpoints ?? {}
  })
  const entries = Object.values(store)
  expect(entries.every((lines) => !lines.includes(3))).toBe(true)

  // Decoration should be gone too.
  await expect(window.locator('.matslop-breakpoint-glyph')).toHaveCount(0)
})
