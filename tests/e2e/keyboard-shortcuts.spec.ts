/**
 * US-035: Keyboard shortcut editor in Preferences.
 *
 * Verifies that the Keyboard tab lists all commands, can rebind a shortcut
 * via a simulated keyboard capture, persists the override, and flags
 * conflicts when two actions share the same key combo.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'

test.describe('US-035: Keyboard shortcut editor', () => {
  test('lists all shortcuts, rebinds one, persists, and flags conflicts', async () => {
    const { app, window, userDataDir } = await launchApp()
    try {
      // Open Preferences via the menu action IPC used by other specs.
      await window.evaluate(() => window.matslop._testMenuAction?.('preferences'))

      // Switch to Keyboard tab.
      const keyboardTab = window.getByTestId('prefs-tab-keyboard')
      await expect(keyboardTab).toBeVisible()
      await keyboardTab.click()
      await expect(window.getByTestId('prefs-shortcuts-table')).toBeVisible()

      // The Save row should be present with its default Ctrl+S binding.
      const saveBtn = window.getByTestId('prefs-shortcut-btn-save')
      await expect(saveBtn).toHaveText('Ctrl+S')

      // Click the binding to start capture, then dispatch a KeyboardEvent
      // for Ctrl+Alt+K. We dispatch directly on window so the useEffect's
      // window-level keydown listener sees it.
      await saveBtn.click()
      await expect(saveBtn).toHaveText(/Press a key combination/)

      await window.evaluate(() => {
        const ev = new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
        window.dispatchEvent(ev)
      })

      await expect(saveBtn).toHaveText('Ctrl+Alt+K')

      // Reset button should now appear.
      const resetBtn = window.getByTestId('prefs-shortcut-reset-save')
      await expect(resetBtn).toBeVisible()

      // Verify persistence via the IPC.
      const stored = await window.evaluate(() => window.matslop.configGetShortcuts())
      expect(stored).toHaveProperty('save')
      expect((stored as Record<string, { key: string; ctrl?: boolean; alt?: boolean }>).save.key).toBe('k')
      expect((stored as Record<string, { key: string; ctrl?: boolean; alt?: boolean }>).save.ctrl).toBe(true)
      expect((stored as Record<string, { key: string; ctrl?: boolean; alt?: boolean }>).save.alt).toBe(true)

      // Rebind Save onto Ctrl+F (which is Find) to force a conflict.
      await saveBtn.click()
      await window.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }))
      })
      await expect(saveBtn).toHaveText('Ctrl+F')

      // Both save and find rows should be marked conflicted.
      const saveRow = window.getByTestId('prefs-shortcut-row-save')
      const findRow = window.getByTestId('prefs-shortcut-row-find')
      await expect(saveRow).toHaveAttribute('data-conflicted', 'true')
      await expect(findRow).toHaveAttribute('data-conflicted', 'true')
      await expect(window.getByTestId('prefs-shortcut-conflict-save')).toBeVisible()
      await expect(window.getByTestId('prefs-shortcut-conflict-find')).toBeVisible()

      // Reset Save only — conflict should clear.
      await window.getByTestId('prefs-shortcut-reset-save').click()
      await expect(saveBtn).toHaveText('Ctrl+S')
      await expect(saveRow).toHaveAttribute('data-conflicted', 'false')
      await expect(findRow).toHaveAttribute('data-conflicted', 'false')

      // After reset, the persisted override for save should be gone.
      const storedAfter = await window.evaluate(() => window.matslop.configGetShortcuts())
      expect((storedAfter as Record<string, unknown>).save).toBeUndefined()
    } finally {
      await closeApp(app, userDataDir)
    }
  })
})
