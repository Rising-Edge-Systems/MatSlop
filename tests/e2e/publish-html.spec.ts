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
 * US-T04: End-to-end verification that File > Publish > HTML... writes a
 * working, self-contained .html file for a .m script.
 *
 * The test:
 *   1. Launches the packaged app, waits for Octave to reach Ready.
 *   2. Opens `hello.m` from the fixtures dir (it runs `disp('Hello from MatSlop')`).
 *   3. Stubs `window.matslop.publishSaveDialog` to return a temp file path so
 *      the native save dialog never blocks CI, and lets the real
 *      `publish:writeFile` IPC actually write to disk.
 *   4. Dispatches the `publishHtml` menu action through the test-only
 *      `_testMenuAction` bridge (same pattern as the other e2e specs).
 *   5. Reads the resulting HTML back from disk and asserts that it:
 *        - starts with `<!DOCTYPE html>` and carries the filename as the title
 *        - contains the script's disp() output (captured via evalc inside
 *          handlePublishHtml so the published doc carries real runtime output)
 *        - contains a syntax-highlighted code listing
 *        - is self-contained (no external CSS/JS, no remote hrefs, no <script>)
 */

let app: ElectronApplication
let window: Page
let userDataDir: string
let tmpOutDir: string

test.beforeAll(async () => {
  ({ app, window, userDataDir } = await launchApp())
  await waitForOctaveReady(window)
  tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-publish-e2e-'))
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
  try {
    fs.rmSync(tmpOutDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('Publish > HTML writes a self-contained HTML file with code + output', async () => {
  // Open a small .m script with known disp output.
  const scriptFixture = path.join(FIXTURES_DIR, 'scripts', 'hello.m')
  await openFileInEditor(window, scriptFixture)
  await expect(
    window.locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]'),
  ).toBeVisible()

  // Stub the save dialog to point at our temp dir. The real writeFile IPC
  // is left alone so the full disk-write path is exercised end-to-end.
  const outFile = path.join(tmpOutDir, 'hello.html')
  await window.evaluate((target) => {
    const w = window as unknown as {
      matslop: {
        publishSaveDialog: (name: string) => Promise<{ filePath: string } | null>
      }
      __mslp_publish_dialog_default__?: string
    }
    const original = w.matslop.publishSaveDialog
    w.matslop.publishSaveDialog = async (name: string) => {
      w.__mslp_publish_dialog_default__ = name
      void original // keep a reference so TS doesn't complain about unused binding
      return { filePath: target }
    }
  }, outFile)

  // Fire the menu action — same wiring the real File menu uses.
  await window.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).matslop._testMenuAction('publishHtml')
  })

  // Wait for the file to appear on disk.
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) break
    await new Promise((r) => setTimeout(r, 200))
  }
  expect(fs.existsSync(outFile)).toBe(true)

  const html = fs.readFileSync(outFile, 'utf8')

  // Document shape
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  expect(html).toContain('<title>hello.m</title>')
  expect(html).toContain('<h1>hello.m</h1>')

  // Syntax-highlighted code listing
  expect(html).toContain('class="ms-code"')
  expect(html).toMatch(/<span class="(str|com|kw|num)">/)

  // disp() runtime output captured and embedded
  expect(html).toContain('Hello from MatSlop')
  expect(html).toContain('class="ms-output"')

  // Self-contained: no external resources, no JS
  expect(html).not.toMatch(/<script\b/i)
  expect(html).not.toMatch(/<link\b[^>]*\brel=["']?stylesheet/i)
  expect(html).not.toMatch(/src=["']https?:\/\//i)
  expect(html).not.toMatch(/href=["']https?:\/\//i)
  // Inline <style> block present
  expect(html).toMatch(/<style>[\s\S]+?<\/style>/)

  // Save dialog was invoked with a derived default filename
  const dialogDefault = await window.evaluate(
    () =>
      (window as unknown as { __mslp_publish_dialog_default__?: string })
        .__mslp_publish_dialog_default__ ?? '',
  )
  expect(dialogDefault).toBe('hello.html')
})
