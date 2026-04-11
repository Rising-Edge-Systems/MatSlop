/**
 * US-037: Main-process git integration.
 *
 * Spawns the system `git` binary via child_process.execFile with a bounded
 * timeout and cwd. Each helper returns a plain JS object so the renderer's
 * IPC bridge can ship it across the preload divide.
 *
 * All helpers are defensive: if git isn't on PATH, or the directory isn't
 * a repo, they return `{ isRepo: false, error: ... }` instead of throwing.
 */

import { execFile } from 'child_process'
import path from 'path'
import {
  parseGitStatusPorcelain,
  parseUnifiedDiff,
  type GitStatusEntry,
  type ParsedDiff,
} from '../renderer/git/gitCore'

export interface GitStatusResult {
  isRepo: boolean
  repoRoot: string | null
  branch: string | null
  entries: GitStatusEntry[]
  error?: string
}

export interface GitDiffResult {
  isRepo: boolean
  diff: ParsedDiff | null
  error?: string
}

export interface GitCommitResult {
  success: boolean
  commit?: string
  error?: string
}

const GIT_TIMEOUT_MS = 15000
const GIT_MAX_BUFFER = 8 * 1024 * 1024

function runGit(
  cwd: string,
  args: string[],
  input?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf-8' },
      (err, stdout, stderr) => {
        const code = err ? ((err as NodeJS.ErrnoException).code === 'ENOENT' ? -1 : 1) : 0
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : (err ? String(err) : ''),
          code,
        })
      },
    )
    if (input !== undefined && child.stdin) {
      child.stdin.end(input)
    }
  })
}

/** `git rev-parse --show-toplevel` — resolves the repo root or returns null. */
export async function resolveRepoRoot(cwd: string): Promise<string | null> {
  if (!cwd) return null
  const { stdout, code } = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (code !== 0) return null
  const line = stdout.split(/\r?\n/)[0] ?? ''
  return line.trim() || null
}

/**
 * Core status query. Returns the parsed `--porcelain` entries plus the
 * repo root and current branch so the panel can render a header.
 */
export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  const repoRoot = await resolveRepoRoot(cwd)
  if (!repoRoot) {
    return {
      isRepo: false,
      repoRoot: null,
      branch: null,
      entries: [],
      error: 'Not a git repository',
    }
  }
  const statusP = runGit(repoRoot, ['status', '--porcelain=v1'])
  const branchP = runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const [status, branch] = await Promise.all([statusP, branchP])
  if (status.code !== 0) {
    return {
      isRepo: true,
      repoRoot,
      branch: null,
      entries: [],
      error: status.stderr || 'git status failed',
    }
  }
  const entries = parseGitStatusPorcelain(status.stdout)
  // Resolve each entry path to absolute so the renderer FileBrowser can
  // look them up directly by absolute path.
  for (const entry of entries) {
    entry.path = path.join(repoRoot, entry.path)
    if (entry.origPath) entry.origPath = path.join(repoRoot, entry.origPath)
  }
  const branchLine = (branch.stdout.split(/\r?\n/)[0] ?? '').trim()
  return {
    isRepo: true,
    repoRoot,
    branch: branchLine || null,
    entries,
  }
}

/**
 * Diff for a single file. `staged` flips between `git diff --cached` and
 * plain `git diff`. Untracked files go through `git diff --no-index
 * /dev/null <path>` so the viewer still shows their contents as additions.
 */
export async function getGitDiff(
  cwd: string,
  filePath: string,
  staged: boolean,
  untracked: boolean,
): Promise<GitDiffResult> {
  const repoRoot = await resolveRepoRoot(cwd)
  if (!repoRoot) {
    return { isRepo: false, diff: null, error: 'Not a git repository' }
  }
  let args: string[]
  if (untracked) {
    // --no-index returns non-zero when files differ; we still want the output.
    args = ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', filePath]
  } else if (staged) {
    args = ['diff', '--cached', '--', filePath]
  } else {
    args = ['diff', '--', filePath]
  }
  const { stdout, stderr, code } = await runGit(repoRoot, args)
  // --no-index sets exit 1 when files differ, but still writes the diff.
  if (code !== 0 && !untracked) {
    if (!stdout) {
      return { isRepo: true, diff: null, error: stderr || 'git diff failed' }
    }
  }
  const parsed = parseUnifiedDiff(stdout)
  return { isRepo: true, diff: parsed }
}

/** `git add <file>` or `git reset HEAD -- <file>`. */
export async function stageFile(
  cwd: string,
  filePath: string,
  stage: boolean,
): Promise<{ success: boolean; error?: string }> {
  const repoRoot = await resolveRepoRoot(cwd)
  if (!repoRoot) return { success: false, error: 'Not a git repository' }
  const args = stage
    ? ['add', '--', filePath]
    : ['reset', 'HEAD', '--', filePath]
  const { code, stderr } = await runGit(repoRoot, args)
  if (code !== 0) return { success: false, error: stderr || 'git failed' }
  return { success: true }
}

/** Commit currently staged changes. */
export async function gitCommit(
  cwd: string,
  message: string,
): Promise<GitCommitResult> {
  const repoRoot = await resolveRepoRoot(cwd)
  if (!repoRoot) return { success: false, error: 'Not a git repository' }
  const trimmed = message.trim()
  if (!trimmed) return { success: false, error: 'Commit message is required' }
  // Use -F - + stdin so we don't have to worry about shell quoting.
  const { code, stderr, stdout } = await runGit(
    repoRoot,
    ['commit', '-F', '-'],
    trimmed,
  )
  if (code !== 0) {
    return { success: false, error: (stderr || stdout || 'git commit failed').trim() }
  }
  // Best-effort commit hash parse from the first line of stdout.
  const m = /\[[^\]]*\s([0-9a-f]{7,40})\]/.exec(stdout)
  return { success: true, commit: m ? m[1] : undefined }
}
