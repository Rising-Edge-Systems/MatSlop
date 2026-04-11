import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ThemeMode } from '../App'
import {
  SHORTCUT_DEFINITIONS,
  shortcutManager,
  type ShortcutAction,
  type ShortcutDefinition,
} from '../shortcuts/shortcutManager'
import {
  applyShortcutOverrides,
  bindingFromKeyboardEvent,
  conflictingActions,
  defToBinding,
  formatBindingLabel,
  parseStoredOverrides,
  pruneRedundantOverrides,
  type ShortcutBinding,
  type ShortcutOverrides,
} from '../shortcuts/customShortcuts'

export interface EditorPreferences {
  theme: ThemeMode
  fontFamily: string
  fontSize: number
  tabSize: number
  insertSpaces: boolean
  defaultWorkingDirectory: string
  octavePath: string
  /** US-034: Restore last session (tabs + cursor) on launch. */
  sessionRestore: boolean
}

interface PreferencesDialogProps {
  onClose: () => void
  onPreferencesChanged: (prefs: EditorPreferences) => void
}

export default function PreferencesDialog({
  onClose,
  onPreferencesChanged,
}: PreferencesDialogProps): React.JSX.Element {
  const [prefs, setPrefs] = useState<EditorPreferences>({
    // US-Q01: matches DEFAULT_THEME in main/appConfig.ts so the dialog opens
    // showing the real seeded default before the persisted prefs load in.
    theme: 'dark',
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: 14,
    tabSize: 4,
    insertSpaces: true,
    defaultWorkingDirectory: '',
    octavePath: '',
    sessionRestore: true,
  })
  const [octaveStatus, setOctaveStatus] = useState<string | null>(null)

  // US-035: Keyboard shortcut editor state.
  const [activeTab, setActiveTab] = useState<'general' | 'keyboard'>('general')
  const [shortcutOverrides, setShortcutOverridesState] = useState<ShortcutOverrides>({})
  const [capturingAction, setCapturingAction] = useState<ShortcutAction | null>(null)
  const captureInputRef = useRef<HTMLInputElement | null>(null)

  // Derived: merged list of shortcut definitions with overrides applied,
  // and which actions currently participate in a conflict.
  const mergedShortcutDefs: ShortcutDefinition[] = useMemo(
    () => applyShortcutOverrides(SHORTCUT_DEFINITIONS, shortcutOverrides),
    [shortcutOverrides],
  )
  const conflictSet = useMemo(() => conflictingActions(mergedShortcutDefs), [mergedShortcutDefs])

  useEffect(() => {
    loadPreferences()
  }, [])

  // US-035: When the capture input gains focus, intercept the next key
  // combination and commit it as an override for the active action.
  useEffect(() => {
    if (!capturingAction) return
    const handler = (e: KeyboardEvent): void => {
      // Swallow so Monaco/global shortcut manager don't see it.
      e.preventDefault()
      e.stopPropagation()
      const binding = bindingFromKeyboardEvent(e)
      if (!binding) return // naked modifier — keep waiting
      if (binding.key === 'escape') {
        // Escape cancels the capture without mutating the binding.
        setCapturingAction(null)
        return
      }
      commitOverride(capturingAction, binding)
      setCapturingAction(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturingAction])

  async function loadPreferences(): Promise<void> {
    const stored = await window.matslop.configGetPreferences()
    const octPath = (await window.matslop.octaveGetPath()) ?? ''
    const sessionRestore = await window.matslop.sessionGetRestoreEnabled()
    setPrefs({
      theme: stored.theme,
      fontFamily: stored.fontFamily,
      fontSize: stored.fontSize,
      tabSize: stored.tabSize,
      insertSpaces: stored.insertSpaces,
      defaultWorkingDirectory: stored.defaultWorkingDirectory,
      octavePath: octPath,
      sessionRestore,
    })
    // US-035: load persisted shortcut overrides for the Keyboard tab.
    try {
      const raw = await window.matslop.configGetShortcuts()
      const parsed = parseStoredOverrides(raw)
      setShortcutOverridesState(parsed)
    } catch {
      setShortcutOverridesState({})
    }
  }

  // US-035: Persist + activate a new binding for an action.
  const commitOverride = useCallback(
    (action: ShortcutAction, binding: ShortcutBinding) => {
      setShortcutOverridesState((prev) => {
        const next = { ...prev, [action]: binding }
        const pruned = pruneRedundantOverrides(next, SHORTCUT_DEFINITIONS)
        // Persist
        void window.matslop.configSetShortcuts(
          pruned as Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }>,
        )
        // Apply immediately to the running shortcut manager
        shortcutManager.setActiveDefinitions(
          applyShortcutOverrides(SHORTCUT_DEFINITIONS, pruned),
        )
        return pruned
      })
    },
    [],
  )

  // US-035: Reset one action to its default binding.
  const resetShortcut = useCallback((action: ShortcutAction) => {
    setShortcutOverridesState((prev) => {
      const next = { ...prev }
      delete next[action]
      void window.matslop.configSetShortcuts(
        next as Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }>,
      )
      shortcutManager.setActiveDefinitions(
        applyShortcutOverrides(SHORTCUT_DEFINITIONS, next),
      )
      return next
    })
  }, [])

  // US-035: Reset all shortcuts to their defaults.
  const resetAllShortcuts = useCallback(() => {
    setShortcutOverridesState({})
    void window.matslop.configSetShortcuts({})
    shortcutManager.setActiveDefinitions([...SHORTCUT_DEFINITIONS])
  }, [])

  const applyAndNotify = useCallback(
    (updated: EditorPreferences) => {
      // Persist general preferences
      window.matslop.configSetPreferences({
        theme: updated.theme,
        fontFamily: updated.fontFamily,
        fontSize: updated.fontSize,
        tabSize: updated.tabSize,
        insertSpaces: updated.insertSpaces,
        defaultWorkingDirectory: updated.defaultWorkingDirectory,
      })
      // Persist theme separately (existing channel)
      window.matslop.configSetTheme(updated.theme)
      // US-034: persist the session-restore preference through its own IPC.
      void window.matslop.sessionSetRestoreEnabled(updated.sessionRestore)
      // Notify parent for immediate application
      onPreferencesChanged(updated)
    },
    [onPreferencesChanged]
  )

  const updatePref = <K extends keyof EditorPreferences>(
    key: K,
    value: EditorPreferences[K]
  ): void => {
    const updated = { ...prefs, [key]: value }
    setPrefs(updated)
    applyAndNotify(updated)
  }

  const handleBrowseOctave = async (): Promise<void> => {
    const selected = await window.matslop.octaveBrowse()
    if (selected) {
      setOctaveStatus('Validating...')
      const result = await window.matslop.octaveValidate(selected)
      if (result.valid) {
        await window.matslop.octaveSetPath(selected)
        setPrefs((prev) => ({ ...prev, octavePath: selected }))
        setOctaveStatus(`Valid - GNU Octave ${result.version}`)
      } else {
        setOctaveStatus(result.error ?? 'Invalid binary')
      }
    }
  }

  const handleOctavePathChange = async (): Promise<void> => {
    const p = prefs.octavePath.trim()
    if (!p) return
    setOctaveStatus('Validating...')
    const result = await window.matslop.octaveValidate(p)
    if (result.valid) {
      await window.matslop.octaveSetPath(p)
      setOctaveStatus(`Valid - GNU Octave ${result.version}`)
    } else {
      setOctaveStatus(result.error ?? 'Invalid binary')
    }
  }

  const handleBrowseWorkDir = async (): Promise<void> => {
    const selected = await window.matslop.selectDirectory()
    if (selected) {
      updatePref('defaultWorkingDirectory', selected)
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="prefs-dialog">
        <div className="prefs-dialog-header">
          <h2>Preferences</h2>
          <button className="prefs-close-btn" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {/* US-035: Tab bar */}
        <div className="prefs-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'general'}
            className={`prefs-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
            data-testid="prefs-tab-general"
          >
            General
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'keyboard'}
            className={`prefs-tab ${activeTab === 'keyboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('keyboard')}
            data-testid="prefs-tab-keyboard"
          >
            Keyboard
          </button>
        </div>

        <div className="prefs-dialog-body" data-testid={`prefs-body-${activeTab}`}>
          {activeTab === 'keyboard' ? (
            <div className="prefs-section" data-testid="prefs-shortcuts-section">
              <h3>Keyboard Shortcuts</h3>
              <table className="prefs-shortcuts-table" data-testid="prefs-shortcuts-table">
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Shortcut</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {mergedShortcutDefs.map((def) => {
                    const isCapturing = capturingAction === def.action
                    const isConflicted = conflictSet.has(def.action)
                    const isOverridden = Boolean(shortcutOverrides[def.action])
                    return (
                      <tr
                        key={def.action}
                        data-testid={`prefs-shortcut-row-${def.action}`}
                        data-conflicted={isConflicted ? 'true' : 'false'}
                      >
                        <td className="prefs-shortcut-desc">{def.description}</td>
                        <td>
                          <button
                            type="button"
                            className={`prefs-shortcut-binding ${isCapturing ? 'capturing' : ''} ${isConflicted ? 'conflicted' : ''}`}
                            data-testid={`prefs-shortcut-btn-${def.action}`}
                            onClick={() => {
                              setCapturingAction(def.action)
                              // Briefly focus a hidden input so blurs can cancel.
                              captureInputRef.current?.focus()
                            }}
                            title={isConflicted ? 'This shortcut conflicts with another command' : 'Click and press a key combination'}
                          >
                            {isCapturing ? 'Press a key combination…' : formatBindingLabel(defToBinding(def))}
                          </button>
                          {isConflicted && (
                            <span
                              className="prefs-shortcut-conflict"
                              data-testid={`prefs-shortcut-conflict-${def.action}`}
                            >
                              ⚠ conflict
                            </span>
                          )}
                        </td>
                        <td>
                          {isOverridden && (
                            <button
                              type="button"
                              className="prefs-shortcut-reset"
                              data-testid={`prefs-shortcut-reset-${def.action}`}
                              onClick={() => resetShortcut(def.action)}
                              title="Reset to default"
                            >
                              Reset
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="prefs-shortcuts-footer">
                <button
                  type="button"
                  className="prefs-browse-btn"
                  data-testid="prefs-shortcuts-reset-all"
                  onClick={resetAllShortcuts}
                >
                  Reset All to Defaults
                </button>
                <input
                  ref={captureInputRef}
                  type="text"
                  tabIndex={-1}
                  readOnly
                  className="prefs-shortcut-capture-input"
                  aria-hidden="true"
                  onBlur={() => setCapturingAction(null)}
                />
              </div>
            </div>
          ) : (
          <>
          {/* Editor Section */}
          <div className="prefs-section">
            <h3>Editor</h3>

            <div className="prefs-row">
              <label>Font Family</label>
              <input
                type="text"
                className="prefs-input"
                value={prefs.fontFamily}
                onChange={(e) => updatePref('fontFamily', e.target.value)}
              />
            </div>

            <div className="prefs-row">
              <label>Font Size</label>
              <select
                className="prefs-select"
                value={prefs.fontSize}
                onChange={(e) => updatePref('fontSize', parseInt(e.target.value))}
              >
                {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((s) => (
                  <option key={s} value={s}>
                    {s}px
                  </option>
                ))}
              </select>
            </div>

            <div className="prefs-row">
              <label>Tab Size</label>
              <select
                className="prefs-select"
                value={prefs.tabSize}
                onChange={(e) => updatePref('tabSize', parseInt(e.target.value))}
              >
                <option value={2}>2 spaces</option>
                <option value={4}>4 spaces</option>
                <option value={8}>8 spaces</option>
              </select>
            </div>

            <div className="prefs-row">
              <label>Indentation</label>
              <select
                className="prefs-select"
                value={prefs.insertSpaces ? 'spaces' : 'tabs'}
                onChange={(e) => updatePref('insertSpaces', e.target.value === 'spaces')}
              >
                <option value="spaces">Spaces</option>
                <option value="tabs">Tabs</option>
              </select>
            </div>
          </div>

          {/* Appearance Section */}
          <div className="prefs-section">
            <h3>Appearance</h3>

            <div className="prefs-row">
              <label>Theme</label>
              <select
                className="prefs-select"
                value={prefs.theme}
                onChange={(e) => updatePref('theme', e.target.value as ThemeMode)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>

          {/* Octave Section */}
          <div className="prefs-section">
            <h3>GNU Octave</h3>

            <div className="prefs-row">
              <label>Executable Path</label>
              <div className="prefs-path-row">
                <input
                  type="text"
                  className="prefs-input prefs-path-input"
                  value={prefs.octavePath}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, octavePath: e.target.value }))}
                  onBlur={handleOctavePathChange}
                  placeholder="Path to octave-cli..."
                />
                <button className="prefs-browse-btn" onClick={handleBrowseOctave}>
                  Browse...
                </button>
              </div>
              {octaveStatus && (
                <div className={`prefs-octave-status ${octaveStatus.startsWith('Valid') ? 'valid' : octaveStatus === 'Validating...' ? '' : 'invalid'}`}>
                  {octaveStatus}
                </div>
              )}
            </div>
          </div>

          {/* Workspace Section */}
          <div className="prefs-section">
            <h3>Workspace</h3>

            <div className="prefs-row">
              <label>Default Working Directory</label>
              <div className="prefs-path-row">
                <input
                  type="text"
                  className="prefs-input prefs-path-input"
                  value={prefs.defaultWorkingDirectory}
                  onChange={(e) => updatePref('defaultWorkingDirectory', e.target.value)}
                  placeholder="Leave empty to use home directory"
                />
                <button className="prefs-browse-btn" onClick={handleBrowseWorkDir}>
                  Browse...
                </button>
              </div>
            </div>

            {/* US-034: Session save/restore toggle */}
            <div className="prefs-row">
              <label htmlFor="prefs-session-restore">Restore previous session on launch</label>
              <input
                id="prefs-session-restore"
                data-testid="prefs-session-restore"
                type="checkbox"
                checked={prefs.sessionRestore}
                onChange={(e) => updatePref('sessionRestore', e.target.checked)}
              />
            </div>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
