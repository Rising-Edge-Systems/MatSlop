import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, waitForOctaveReady, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-006: Continuous output column scrolls with code column.
 *
 * Verifies:
 *   - Vertical scroll lives on the `.ls-editor` container, not per cell.
 *   - `.ls-cell-output` no longer clamps its height (max-height: none) and does
 *     not create its own vertical scrollbar.
 *   - `.ls-cell-output-side` constrains horizontal overflow (overflow-x: hidden)
 *     so a wide output cannot widen its grid track and break row alignment.
 *   - Injecting a very tall output into one cell expands that row instead of
 *     creating an inner scroll, and neighboring code/output rows remain
 *     horizontally aligned.
 *   - Injecting a very wide output into one cell does not push neighboring
 *     rows out of the grid tracks.
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

test('scrolling lives on the .ls-editor container, not per cell', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const scroll = await window.evaluate(() => {
    const editor = document.querySelector('.ls-editor') as HTMLElement | null
    const outputs = Array.from(document.querySelectorAll('.ls-cell-output')) as HTMLElement[]
    const outputSides = Array.from(document.querySelectorAll('.ls-cell-output-side')) as HTMLElement[]
    return {
      editorOverflowY: editor ? getComputedStyle(editor).overflowY : null,
      // Every per-cell .ls-cell-output should not be a vertical scroll container.
      outputs: outputs.map((o) => ({
        maxHeight: getComputedStyle(o).maxHeight,
        overflowY: getComputedStyle(o).overflowY,
      })),
      // Output-side grid items clamp horizontal overflow so wide outputs do
      // not bleed into or widen the next grid track.
      outputSides: outputSides.map((o) => ({
        overflowX: getComputedStyle(o).overflowX,
        overflowY: getComputedStyle(o).overflowY,
      })),
    }
  })

  expect(scroll.editorOverflowY).toBe('auto')
  expect(scroll.outputs.length).toBeGreaterThan(0)
  for (const o of scroll.outputs) {
    expect(o.maxHeight).toBe('none')
    // visible or auto-with-no-max-height — but NOT a fixed scroll container.
    expect(['visible', 'clip']).toContain(o.overflowY)
  }
  expect(scroll.outputSides.length).toBeGreaterThan(0)
  for (const o of scroll.outputSides) {
    expect(['hidden', 'clip']).toContain(o.overflowX)
    expect(['visible', 'clip']).toContain(o.overflowY)
  }
})

test('a very tall output expands its grid row and is scrolled by the .ls-editor container', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  const before = await window.evaluate(() => {
    const editor = document.querySelector('.ls-editor') as HTMLElement
    const outputs = Array.from(document.querySelectorAll('[data-testid="ls-cell-output"]')) as HTMLElement[]
    return {
      editorScrollHeight: editor.scrollHeight,
      editorClientHeight: editor.clientHeight,
      outputCount: outputs.length,
      firstOutputId: outputs[0]?.getAttribute('data-cell-id'),
    }
  })
  expect(before.outputCount).toBeGreaterThanOrEqual(2)

  // Inject a very tall synthetic output into the first output-side grid item.
  await window.evaluate(() => {
    const output = document.querySelector('[data-testid="ls-cell-output"]') as HTMLElement
    const tall = document.createElement('div')
    tall.id = '__test_tall_output'
    tall.style.height = '1200px'
    tall.style.background = 'red'
    output.appendChild(tall)
  })

  const after = await window.evaluate(() => {
    const editor = document.querySelector('.ls-editor') as HTMLElement
    const output = document.querySelector('[data-testid="ls-cell-output"]') as HTMLElement
    const outputSide = output as HTMLElement
    const allOutputs = Array.from(document.querySelectorAll('[data-testid="ls-cell-output"]')) as HTMLElement[]
    const allCodeSides = Array.from(document.querySelectorAll('[data-testid="ls-cell"][data-cell-type="code"]')) as HTMLElement[]
    // Neighbor row alignment: each remaining code/output sibling pair should still
    // have matching top coordinates (same grid-row).
    const pairAlignment = allCodeSides.map((code) => {
      const cid = code.dataset.cellId
      const out = allOutputs.find((o) => o.getAttribute('data-cell-id') === cid)
      return {
        cellId: cid,
        codeTop: code.getBoundingClientRect().top,
        outputTop: out?.getBoundingClientRect().top ?? null,
      }
    })
    return {
      editorScrollHeight: editor.scrollHeight,
      editorClientHeight: editor.clientHeight,
      outputSideOffsetHeight: outputSide.offsetHeight,
      outputSideScrollHeight: outputSide.scrollHeight,
      pairAlignment,
    }
  })

  // The tall injection must expand the row itself: the output-side element
  // is at least as tall as the 1200px injection (plus its own padding/borders).
  expect(after.outputSideOffsetHeight).toBeGreaterThanOrEqual(1200)
  // And there is no internal vertical scroll on the output side — scrollHeight
  // equals offsetHeight-ish (no clipped content).
  expect(after.outputSideScrollHeight).toBeLessThanOrEqual(after.outputSideOffsetHeight + 8)
  // The growing row must in turn grow the .ls-editor's scrollable height.
  expect(after.editorScrollHeight).toBeGreaterThan(before.editorScrollHeight + 500)
  // Scroll is container-level: scrollHeight exceeds clientHeight so the user
  // scrolls the whole live-script, not an inner box.
  expect(after.editorScrollHeight).toBeGreaterThan(after.editorClientHeight)

  // Every code row still aligns horizontally with its output row.
  for (const p of after.pairAlignment) {
    expect(p.outputTop).not.toBeNull()
    expect(Math.abs((p.outputTop as number) - p.codeTop)).toBeLessThan(2)
  }

  // Cleanup the injected node so the next test starts clean.
  await window.evaluate(() => {
    document.getElementById('__test_tall_output')?.remove()
  })
})

test('a very wide output does not push neighboring rows out of alignment', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()

  // Record grid track widths BEFORE the wide injection.
  const before = await window.evaluate(() => {
    const grid = document.querySelector('[data-testid="ls-cells"]') as HTMLElement
    const cs = getComputedStyle(grid)
    return {
      templateColumns: cs.gridTemplateColumns,
      gridWidth: grid.getBoundingClientRect().width,
    }
  })

  // Inject a synthetic output that is absurdly wide (5000px).
  await window.evaluate(() => {
    const output = document.querySelector('[data-testid="ls-cell-output"]') as HTMLElement
    const wide = document.createElement('div')
    wide.id = '__test_wide_output'
    wide.style.width = '5000px'
    wide.style.height = '40px'
    wide.style.background = 'blue'
    wide.style.whiteSpace = 'pre'
    wide.textContent = 'x'.repeat(5000)
    output.appendChild(wide)
  })

  const after = await window.evaluate(() => {
    const grid = document.querySelector('[data-testid="ls-cells"]') as HTMLElement
    const cs = getComputedStyle(grid)
    const outputs = Array.from(document.querySelectorAll('[data-testid="ls-cell-output"]')) as HTMLElement[]
    const codeSides = Array.from(document.querySelectorAll('[data-testid="ls-cell"][data-cell-type="code"]')) as HTMLElement[]
    const pairs = codeSides.map((code) => {
      const cid = code.dataset.cellId
      const out = outputs.find((o) => o.getAttribute('data-cell-id') === cid)
      return {
        cellId: cid,
        codeTop: code.getBoundingClientRect().top,
        outputTop: out?.getBoundingClientRect().top ?? null,
        codeRight: code.getBoundingClientRect().right,
        outputLeft: out?.getBoundingClientRect().left ?? null,
      }
    })
    return {
      templateColumns: cs.gridTemplateColumns,
      gridWidth: grid.getBoundingClientRect().width,
      pairs,
    }
  })

  // The grid tracks should not have grown — the wide content is clipped by
  // overflow-x: hidden on the output side, not by widening the track.
  expect(after.templateColumns).toBe(before.templateColumns)
  // Grid container width is essentially unchanged (±2px tolerance for
  // scrollbar gutter fluctuations).
  expect(Math.abs(after.gridWidth - before.gridWidth)).toBeLessThan(4)

  // Every pair still has the output's top matching its code sibling's top,
  // and output sits immediately right of code.
  for (const p of after.pairs) {
    expect(p.outputTop).not.toBeNull()
    expect(Math.abs((p.outputTop as number) - p.codeTop)).toBeLessThan(2)
    expect(p.outputLeft as number).toBeGreaterThanOrEqual(p.codeRight - 2)
  }

  // Cleanup.
  await window.evaluate(() => {
    document.getElementById('__test_wide_output')?.remove()
  })
})
