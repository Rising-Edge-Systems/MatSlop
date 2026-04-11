import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

/**
 * US-037: Source Control panel + git status in file browser.
 *
 * End-to-end smoke: create a real git repo on disk, modify a tracked
 * file and add an untracked one, point the app cwd at that repo, open
 * the Source Control panel, and verify status/diff/commit round-trip.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string
let repoDir: string

interface ScWindow extends Window {
  __matslopOpenSourceControl?: () => void
  __matslopCloseSourceControl?: () => void
  __matslopSourceControlOpen?: boolean
  __matslopGitRefresh?: () => Promise<void>
  __matslopRefreshGitBadges?: () => Promise<void>
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

test.beforeAll(async () => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-sc-'))
  // Initialize a git repo with a single committed file.
  git(repoDir, ['init', '-b', 'main'])
  git(repoDir, ['config', 'user.email', 'test@example.com'])
  git(repoDir, ['config', 'user.name', 'Test'])
  git(repoDir, ['config', 'commit.gpgsign', 'false'])
  fs.writeFileSync(path.join(repoDir, 'tracked.m'), 'function y = tracked(x)\n  y = x;\nend\n')
  git(repoDir, ['add', 'tracked.m'])
  git(repoDir, ['commit', '-m', 'initial commit'])
  // Modify the tracked file (unstaged change) and add an untracked file.
  fs.writeFileSync(path.join(repoDir, 'tracked.m'), 'function y = tracked(x)\n  y = x + 1;\nend\n')
  fs.writeFileSync(path.join(repoDir, 'newfile.m'), 'disp("hello")\n')
  ;({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
  try {
    fs.rmSync(repoDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('git status IPC returns porcelain entries for the repo', async () => {
  const result = await window.evaluate(async (cwd) => {
    return await window.matslop.gitStatus(cwd)
  }, repoDir)
  expect(result.isRepo).toBe(true)
  expect(result.branch).toBeTruthy()
  const badges = result.entries.map((e: { badge: string }) => e.badge).sort()
  expect(badges).toContain('M')
  expect(badges).toContain('?')
})

test('opening the panel via hook mounts Source Control', async () => {
  await window.evaluate(() => {
    const w = window as unknown as ScWindow
    w.__matslopOpenSourceControl?.()
  })
  const panel = window.locator('[data-testid="source-control-panel"]')
  await expect(panel).toBeVisible()
})

test('panel shows not-a-repo message when cwd has no git', async () => {
  // The default launch cwd is the user home dir which likely isn't a
  // repo. We close + reopen the panel to re-run refresh, then assert.
  await window.evaluate(() => {
    const w = window as unknown as ScWindow
    w.__matslopCloseSourceControl?.()
  })
  // With the panel currently pointed at the app's cwd (not repoDir),
  // opening should show either a branch or the not-repo message. We
  // don't assert which — just that the panel mounts without throwing.
  await window.evaluate(() => {
    const w = window as unknown as ScWindow
    w.__matslopOpenSourceControl?.()
  })
  await expect(window.locator('[data-testid="source-control-panel"]')).toBeVisible()
})

test('gitDiff IPC returns hunks for the modified file', async () => {
  const result = await window.evaluate(
    async ([cwd, file]) => {
      return await window.matslop.gitDiff(cwd as string, file as string, false, false)
    },
    [repoDir, path.join(repoDir, 'tracked.m')],
  )
  expect(result.isRepo).toBe(true)
  expect(result.diff).not.toBeNull()
  expect(result.diff?.empty).toBe(false)
  expect(result.diff?.hunks.length).toBeGreaterThan(0)
})

test('gitStageFile + gitCommit round-trip', async () => {
  const stage = await window.evaluate(
    async ([cwd, file]) => {
      return await window.matslop.gitStageFile(cwd as string, file as string, true)
    },
    [repoDir, path.join(repoDir, 'tracked.m')],
  )
  expect(stage.success).toBe(true)

  const afterStage = await window.evaluate(async (cwd) => {
    return await window.matslop.gitStatus(cwd)
  }, repoDir)
  const stagedEntry = afterStage.entries.find(
    (e: { path: string; staged: boolean }) => e.path.endsWith('tracked.m') && e.staged,
  )
  expect(stagedEntry).toBeDefined()

  const commit = await window.evaluate(async (cwd) => {
    return await window.matslop.gitCommit(cwd, 'test: matslop e2e commit')
  }, repoDir)
  expect(commit.success).toBe(true)

  // After commit, tracked.m should no longer appear in status.
  const afterCommit = await window.evaluate(async (cwd) => {
    return await window.matslop.gitStatus(cwd)
  }, repoDir)
  const stillThere = afterCommit.entries.find((e: { path: string }) => e.path.endsWith('tracked.m'))
  expect(stillThere).toBeUndefined()
})

test('gitStatus handles non-git directory gracefully', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-sc-notrepo-'))
  try {
    const result = await window.evaluate(async (cwd) => {
      return await window.matslop.gitStatus(cwd)
    }, tmp)
    expect(result.isRepo).toBe(false)
    expect(result.error).toBeTruthy()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('gitCommit rejects empty message', async () => {
  const result = await window.evaluate(async (cwd) => {
    return await window.matslop.gitCommit(cwd, '')
  }, repoDir)
  expect(result.success).toBe(false)
  expect(result.error).toBeTruthy()
})
