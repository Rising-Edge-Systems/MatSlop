/**
 * US-032: Main-process filesystem walker for Find in Files.
 *
 * Walks a directory tree (bounded depth / entry count), filters files
 * by a glob pattern, and runs the pure `searchFileText` helper from the
 * renderer-side findInFiles module on each file's contents.
 *
 * The walker lives in main because it needs fs access; the core match
 * logic is shared with the renderer so glob/search semantics never drift.
 */

import fs from 'fs'
import path from 'path'
import {
  matchesGlob,
  searchFileText,
  type FindMatch,
  type SearchOptions,
} from '../renderer/editor/findInFiles'

/** Directory names we never descend into (avoid hammering node_modules). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.cache',
])

/** File extensions we never try to search (binary-ish). */
const SKIP_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.mov', '.wav', '.avi', '.mkv',
  '.mat', '.npy', '.woff', '.woff2', '.ttf', '.eot',
])

export interface FindInFilesOptions extends SearchOptions {
  /** Glob pattern for filename filter (comma-separated). Empty = all. */
  glob?: string
  /** Max directory depth (root = 0). Default 10. */
  maxDepth?: number
  /** Max total files scanned. Default 5000. */
  maxFiles?: number
  /** Max total match results returned. Default 2000. */
  maxResults?: number
  /** Skip files larger than this many bytes. Default 2 MB. */
  maxFileBytes?: number
}

export interface FindInFilesResult {
  matches: FindMatch[]
  filesScanned: number
  truncated: boolean
  error?: string
}

/**
 * Walk a directory and search every text file whose basename matches
 * `glob` for the given query. Returns the collected matches along with a
 * summary of how much work was done.
 *
 * On any filesystem error the result is still returned (partial results
 * OK); the caller sees `error` populated when the root directory itself
 * couldn't be read.
 */
export function findInFiles(
  rootDir: string,
  query: string,
  opts: FindInFilesOptions = {},
): FindInFilesResult {
  const glob = opts.glob ?? ''
  const maxDepth = opts.maxDepth ?? 10
  const maxFiles = opts.maxFiles ?? 5000
  const maxResults = opts.maxResults ?? 2000
  const maxFileBytes = opts.maxFileBytes ?? 2 * 1024 * 1024

  const matches: FindMatch[] = []
  let filesScanned = 0
  let truncated = false

  if (!query) {
    return { matches, filesScanned, truncated }
  }

  // Quick existence check for root dir.
  try {
    const rootStat = fs.statSync(rootDir)
    if (!rootStat.isDirectory()) {
      return { matches, filesScanned, truncated, error: 'not a directory' }
    }
  } catch (err) {
    return { matches, filesScanned, truncated, error: String(err) }
  }

  const walk = (dir: string, depth: number): void => {
    if (truncated) return
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (truncated) return
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (SKIP_EXTS.has(path.extname(entry.name).toLowerCase())) continue
      if (!matchesGlob(entry.name, glob)) continue

      if (filesScanned >= maxFiles) {
        truncated = true
        return
      }
      filesScanned++
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.size > maxFileBytes) continue
      let content: string
      try {
        content = fs.readFileSync(full, 'utf-8')
      } catch {
        continue
      }
      // Cheap binary sniff: presence of a NUL byte almost always means
      // non-text. Cheap because we already have the string.
      if (content.indexOf('\u0000') !== -1) continue
      const fileMatches = searchFileText(full, content, query, opts)
      for (const m of fileMatches) {
        matches.push(m)
        if (matches.length >= maxResults) {
          truncated = true
          return
        }
      }
    }
  }

  walk(rootDir, 0)
  return { matches, filesScanned, truncated }
}
