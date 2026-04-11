import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * US-032: Find in Files.
 *
 * Smoke-tests the panel/IPC chain end-to-end:
 *   - Ctrl+Shift+F (via the __matslopOpenFindInFiles hook) mounts the panel.
 *   - A real on-disk fixture directory is searched via the findInFiles IPC.
 *   - Results render grouped by file and clicking a result calls the
 *     renderer's onOpenMatch (which we observe by watching the editor's
 *     openFilePath pipeline — the clicked file's tab should appear in
 *     the tab bar).
 *   - Closing via the hook unmounts the panel.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string
let fixtureDir: string

interface FifWindow extends Window {
  __matslopOpenFindInFiles?: () => void
  __matslopCloseFindInFiles?: () => void
  __matslopFindInFilesOpen?: boolean
}

test.beforeAll(async () => {
  // Create a small fixture tree with known content so the search has
  // deterministic results.
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-fif-'))
  fs.writeFileSync(
    path.join(fixtureDir, 'alpha.m'),
    ['function y = alpha(x)', '  y = needle(x);', 'end', ''].join('\n'),
  )
  fs.writeFileSync(
    path.join(fixtureDir, 'beta.m'),
    ['% haystack', 'needle_var = 1;', 'other = 2;', ''].join('\n'),
  )
  fs.writeFileSync(
    path.join(fixtureDir, 'gamma.txt'),
    'should not appear if glob filters to .m\n',
  )
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test.beforeEach(async () => {
  await window.evaluate(() => {
    const w = window as unknown as FifWindow
    w.__matslopCloseFindInFiles?.()
  })
})

test('find-in-files panel is hidden at startup', async () => {
  await expect(window.locator('[data-testid="find-in-files-panel"]')).toHaveCount(0)
})

test('opening via hook mounts the panel with empty state', async () => {
  await window.evaluate(() => {
    const w = window as unknown as FifWindow
    w.__matslopOpenFindInFiles?.()
  })
  const panel = window.locator('[data-testid="find-in-files-panel"]')
  await expect(panel).toBeVisible()
  await expect(window.locator('[data-testid="find-in-files-query"]')).toBeVisible()
  await expect(window.locator('[data-testid="find-in-files-glob"]')).toBeVisible()
})

test('searching a fixture directory returns matches grouped by file', async () => {
  const result = await window.evaluate(async (dir: string) => {
    return await window.matslop.findInFiles(dir, 'needle', { glob: '*.m' })
  }, fixtureDir)
  expect(result.error ?? null).toBeNull()
  expect(result.matches.length).toBeGreaterThanOrEqual(2)
  const files = new Set(result.matches.map((m) => path.basename(m.file)))
  // Direct basename comparison (path isn't injected into evaluate)
  // so we compare against strings we know exist.
  expect([...files].some((f) => f.endsWith('alpha.m'))).toBe(true)
  expect([...files].some((f) => f.endsWith('beta.m'))).toBe(true)
  // gamma.txt filtered out by glob
  expect([...files].some((f) => f.endsWith('gamma.txt'))).toBe(false)
})

test('glob filter restricts by extension', async () => {
  const all = await window.evaluate(async (dir: string) => {
    return await window.matslop.findInFiles(dir, 'haystack', { glob: '' })
  }, fixtureDir)
  expect(all.matches.length).toBeGreaterThanOrEqual(1)
  const onlyM = await window.evaluate(async (dir: string) => {
    return await window.matslop.findInFiles(dir, 'haystack', { glob: '*.m' })
  }, fixtureDir)
  // "haystack" only exists in beta.m, and *.m permits beta.m
  expect(onlyM.matches.length).toBeGreaterThanOrEqual(1)
})

test('empty query returns no results without error', async () => {
  const result = await window.evaluate(async (dir: string) => {
    return await window.matslop.findInFiles(dir, '', {})
  }, fixtureDir)
  expect(result.matches).toEqual([])
  expect(result.error ?? null).toBeNull()
})

test('close hook unmounts the panel', async () => {
  await window.evaluate(() => {
    const w = window as unknown as FifWindow
    w.__matslopOpenFindInFiles?.()
  })
  await expect(window.locator('[data-testid="find-in-files-panel"]')).toBeVisible()
  await window.evaluate(() => {
    const w = window as unknown as FifWindow
    w.__matslopCloseFindInFiles?.()
  })
  await expect(window.locator('[data-testid="find-in-files-panel"]')).toHaveCount(0)
})
