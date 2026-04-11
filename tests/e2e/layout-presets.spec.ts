import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-028: Layout presets.
 *
 * - Built-in presets (Default, Debugger, Two-Column, Code-Only) apply via
 *   the `layoutPreset:builtin:<id>` menu action.
 * - "Save Current as Preset..." opens a dialog; the resulting name
 *   persists and appears as a custom preset in the layoutPresets list.
 * - Custom presets re-apply via `layoutPreset:custom:<name>`.
 * - Reset Layout returns to the Default preset (alias for
 *   `layoutPreset:builtin:default`).
 *
 * Driven through `window.matslop._testMenuAction` so the main-process
 * menu and the in-app switch handler both exercise the real code path.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

const fileBrowser = () => window.locator('[data-testid="file-browser"]')
const workspace = () => window.locator('[data-testid="workspace-panel"]')
const commandWindow = () => window.locator('[data-testid="command-window"]')

async function menuAction(action: string): Promise<void> {
  await window.evaluate(async (a: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).matslop._testMenuAction(a)
  }, action)
}

test('Code-Only preset hides every non-editor panel', async () => {
  await menuAction('layoutPreset:builtin:codeOnly')
  await expect(fileBrowser()).toBeHidden()
  await expect(workspace()).toBeHidden()
  await expect(commandWindow()).toBeHidden()
})

test('Two-Column preset shows editor + command window only', async () => {
  await menuAction('layoutPreset:builtin:twoColumn')
  await expect(fileBrowser()).toBeHidden()
  await expect(workspace()).toBeHidden()
  await expect(commandWindow()).toBeVisible()
})

test('Debugger preset shows file browser + workspace + command window + history', async () => {
  await menuAction('layoutPreset:builtin:debugger')
  await expect(fileBrowser()).toBeVisible()
  await expect(workspace()).toBeVisible()
  await expect(commandWindow()).toBeVisible()
  // History lives as a sibling tab in the bottom dock panel. rc-dock may
  // render it as an inactive (visibility: hidden) tab, so assert presence
  // via toHaveCount rather than toBeVisible.
  await expect(
    window.locator('[data-testid="dock-tab-matslop-command-history"]'),
  ).toHaveCount(1)
})

test('Default preset (and Reset Layout) restores MATLAB-like arrangement', async () => {
  // First perturb: hide most panels via Code-Only
  await menuAction('layoutPreset:builtin:codeOnly')
  await expect(fileBrowser()).toBeHidden()
  // Apply Default
  await menuAction('layoutPreset:builtin:default')
  await expect(fileBrowser()).toBeVisible()
  await expect(workspace()).toBeVisible()
  await expect(commandWindow()).toBeVisible()
  // Default preset hides the command history — the tab is omitted from
  // the dock tree entirely so the data-testid is gone from the DOM.
  await expect(
    window.locator('[data-testid="dock-tab-matslop-command-history"]'),
  ).toHaveCount(0)

  // Same should happen via Reset Layout
  await menuAction('layoutPreset:builtin:codeOnly')
  await expect(fileBrowser()).toBeHidden()
  await menuAction('resetLayout')
  await expect(fileBrowser()).toBeVisible()
  await expect(workspace()).toBeVisible()
  await expect(commandWindow()).toBeVisible()
})

test('Save Current as Preset round-trips through layoutPresets store', async () => {
  // Start from Two-Column so the saved preset has a distinctive shape.
  await menuAction('layoutPreset:builtin:twoColumn')
  await expect(fileBrowser()).toBeHidden()

  // Open the save-preset dialog via menu action.
  await menuAction('saveLayoutPreset')
  const dialog = window.locator('[data-testid="save-preset-dialog"]')
  await expect(dialog).toBeVisible()

  // Type a unique name and submit.
  const input = window.locator('[data-testid="save-preset-dialog-input"]')
  await input.fill('MyTwoCol')
  await window
    .locator('[data-testid="save-preset-dialog-save"]')
    .dispatchEvent('click')
  await expect(dialog).toBeHidden()

  // The preset should now exist in the store.
  const listed = await window.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).matslop.layoutPresetsList()
  })
  expect(Object.keys(listed)).toContain('MyTwoCol')
  expect(listed.MyTwoCol.visibility.fileBrowser).toBe(false)
  expect(listed.MyTwoCol.visibility.commandWindow).toBe(true)

  // Switch to Default, then re-apply our custom preset.
  await menuAction('layoutPreset:builtin:default')
  await expect(fileBrowser()).toBeVisible()
  await menuAction('layoutPreset:custom:MyTwoCol')
  await expect(fileBrowser()).toBeHidden()
  await expect(workspace()).toBeHidden()
  await expect(commandWindow()).toBeVisible()

  // Delete the custom preset.
  await menuAction('layoutPreset:delete:MyTwoCol')
  const listedAfter = await window.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).matslop.layoutPresetsList()
  })
  expect(Object.keys(listedAfter)).not.toContain('MyTwoCol')
})

test('Save preset dialog rejects reserved and empty names', async () => {
  await menuAction('saveLayoutPreset')
  const dialog = window.locator('[data-testid="save-preset-dialog"]')
  await expect(dialog).toBeVisible()

  const input = window.locator('[data-testid="save-preset-dialog-input"]')
  const saveBtn = window.locator('[data-testid="save-preset-dialog-save"]')
  const error = window.locator('[data-testid="save-preset-dialog-error"]')

  // Empty -> save disabled + error
  await expect(error).toBeVisible()
  await expect(saveBtn).toBeDisabled()

  // Reserved name
  await input.fill('Default')
  await expect(error).toContainText(/reserved/i)
  await expect(saveBtn).toBeDisabled()

  // Invalid characters
  await input.fill('bad:name')
  await expect(error).toContainText(/invalid/i)

  // Valid name re-enables Save
  await input.fill('Ok Layout')
  await expect(error).toBeHidden()
  await expect(saveBtn).toBeEnabled()

  // Cancel
  await window
    .locator('[data-testid="save-preset-dialog-cancel"]')
    .dispatchEvent('click')
  await expect(dialog).toBeHidden()
})
