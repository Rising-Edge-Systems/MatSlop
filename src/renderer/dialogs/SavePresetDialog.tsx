import { useEffect, useRef, useState } from 'react'
import { validatePresetName } from '../editor/layoutPresets'

interface SavePresetDialogProps {
  /** Existing custom preset names (used to warn about overwrites). */
  existingNames: string[]
  onCancel: () => void
  onSave: (name: string) => void
}

/**
 * US-028: Small modal dialog prompting for a new layout preset name.
 *
 * Auto-focuses on open, submits on Enter, dismisses on Escape. If the
 * name collides with an existing custom preset the user is warned but
 * still allowed to overwrite via a confirmation button. Validation
 * errors (empty, reserved, too long, bad chars) inhibit Save entirely
 * until the user clears the mistake.
 */
export default function SavePresetDialog({
  existingNames,
  onCancel,
  onSave,
}: SavePresetDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = name.trim()
  const error = validatePresetName(name)
  const isOverwrite = error === null && existingNames.includes(trimmed)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleSubmit = (e?: React.FormEvent): void => {
    if (e) e.preventDefault()
    if (error) return
    onSave(trimmed)
  }

  return (
    <div
      data-testid="save-preset-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-preset-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--panel-bg, #2d2d30)',
          color: 'var(--text, #ddd)',
          border: '1px solid var(--border, #3a3a3d)',
          borderRadius: 6,
          padding: 20,
          minWidth: 340,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        }}
      >
        <h2
          id="save-preset-dialog-title"
          style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}
        >
          Save Layout Preset
        </h2>
        <label
          style={{ display: 'block', marginBottom: 6, fontSize: 13 }}
          htmlFor="save-preset-dialog-input"
        >
          Preset name:
        </label>
        <input
          id="save-preset-dialog-input"
          ref={inputRef}
          type="text"
          data-testid="save-preset-dialog-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'var(--input-bg, #1e1e1e)',
            color: 'inherit',
            border: `1px solid ${error ? 'var(--error, #d9534f)' : 'var(--border, #3a3a3d)'}`,
            borderRadius: 3,
            font: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <div
            data-testid="save-preset-dialog-error"
            style={{ marginTop: 6, fontSize: 12, color: 'var(--error, #d9534f)' }}
          >
            {error}
          </div>
        )}
        {!error && isOverwrite && (
          <div
            data-testid="save-preset-dialog-overwrite"
            style={{ marginTop: 6, fontSize: 12, color: 'var(--warning, #e0b84a)' }}
          >
            A preset named &quot;{trimmed}&quot; already exists. Saving will overwrite it.
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            data-testid="save-preset-dialog-cancel"
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              color: 'inherit',
              border: '1px solid var(--border, #3a3a3d)',
              borderRadius: 3,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="save-preset-dialog-save"
            disabled={!!error}
            style={{
              padding: '6px 14px',
              background: error ? 'var(--button-disabled, #555)' : 'var(--accent, #0e639c)',
              color: 'white',
              border: '1px solid transparent',
              borderRadius: 3,
              cursor: error ? 'not-allowed' : 'pointer',
              opacity: error ? 0.6 : 1,
              font: 'inherit',
            }}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
