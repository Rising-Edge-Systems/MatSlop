import { useState, useEffect } from 'react'

interface OctaveSetupDialogProps {
  onConfigured: (path: string, version: string) => void
}

export default function OctaveSetupDialog({ onConfigured }: OctaveSetupDialogProps): React.JSX.Element {
  const [octavePath, setOctavePath] = useState('')
  const [status, setStatus] = useState<'detecting' | 'not-found' | 'validating' | 'valid' | 'invalid'>('detecting')
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    detectOctave()
  }, [])

  async function detectOctave(): Promise<void> {
    setStatus('detecting')
    const detected = await window.matslop.octaveAutoDetect()
    if (detected) {
      setOctavePath(detected)
      await validatePath(detected)
    } else {
      setStatus('not-found')
    }
  }

  async function validatePath(binaryPath: string): Promise<void> {
    setStatus('validating')
    setError(null)
    const result = await window.matslop.octaveValidate(binaryPath)
    if (result.valid) {
      setStatus('valid')
      setVersion(result.version ?? 'unknown')
      await window.matslop.octaveSetPath(binaryPath)
      onConfigured(binaryPath, result.version ?? 'unknown')
    } else {
      setStatus('invalid')
      setError(result.error ?? 'Not a valid Octave binary')
    }
  }

  async function handleBrowse(): Promise<void> {
    const selected = await window.matslop.octaveBrowse()
    if (selected) {
      setOctavePath(selected)
      await validatePath(selected)
    }
  }

  async function handleRetry(): Promise<void> {
    if (octavePath.trim()) {
      await validatePath(octavePath.trim())
    }
  }

  if (status === 'detecting') {
    return (
      <div className="octave-setup-overlay">
        <div className="octave-setup-dialog">
          <h2>Detecting GNU Octave...</h2>
          <p className="octave-setup-subtitle">Searching for Octave installation</p>
        </div>
      </div>
    )
  }

  if (status === 'valid') {
    return <></>
  }

  return (
    <div className="octave-setup-overlay">
      <div className="octave-setup-dialog">
        <h2>GNU Octave Not Found</h2>
        <p className="octave-setup-subtitle">
          MatSlop requires GNU Octave to execute MATLAB-compatible code.
          Please install Octave or specify its location.
        </p>

        <div className="octave-setup-instructions">
          <strong>Install GNU Octave:</strong>
          <ul>
            <li>Linux: <code>sudo apt install octave</code> or <code>sudo dnf install octave</code></li>
            <li>macOS: <code>brew install octave</code></li>
            <li>Windows: Download from <code>octave.org</code></li>
          </ul>
        </div>

        <div className="octave-setup-path-row">
          <input
            type="text"
            className="octave-setup-input"
            value={octavePath}
            onChange={(e) => setOctavePath(e.target.value)}
            placeholder="Path to octave-cli or octave binary..."
          />
          <button className="octave-setup-btn" onClick={handleBrowse}>Browse...</button>
        </div>

        {status === 'invalid' && error && (
          <div className="octave-setup-error">{error}</div>
        )}

        {status === 'validating' && (
          <div className="octave-setup-validating">Validating...</div>
        )}

        {version && (
          <div className="octave-setup-version">GNU Octave {version}</div>
        )}

        <div className="octave-setup-actions">
          <button
            className="octave-setup-btn octave-setup-btn-primary"
            onClick={handleRetry}
            disabled={!octavePath.trim() || status === 'validating'}
          >
            Validate & Use
          </button>
        </div>
      </div>
    </div>
  )
}
