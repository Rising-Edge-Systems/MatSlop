import { useState, useEffect, useCallback } from 'react'
import type { ThemeMode } from '../App'

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
    theme: 'system',
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: 14,
    tabSize: 4,
    insertSpaces: true,
    defaultWorkingDirectory: '',
    octavePath: '',
    sessionRestore: true,
  })
  const [octaveStatus, setOctaveStatus] = useState<string | null>(null)

  useEffect(() => {
    loadPreferences()
  }, [])

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
  }

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

        <div className="prefs-dialog-body">
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
        </div>
      </div>
    </div>
  )
}
