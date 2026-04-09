import { useState, useCallback } from 'react'

interface WelcomeTabProps {
  onDismiss: () => void
}

function WelcomeTab({ onDismiss }: WelcomeTabProps): React.JSX.Element {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const handleClose = useCallback(() => {
    if (dontShowAgain) {
      window.matslop.configSetShowWelcome(false)
    }
    onDismiss()
  }, [dontShowAgain, onDismiss])

  return (
    <div className="welcome-tab">
      <div className="welcome-content">
        <h1 className="welcome-title">MatSlop</h1>
        <p className="welcome-subtitle">Open-source MATLAB alternative IDE</p>
        <p className="welcome-version">Version 1.0.0</p>

        <div className="welcome-section">
          <h2>Quick Start</h2>
          <ul className="welcome-tips">
            <li><strong>New Script:</strong> Ctrl+N to create a new .m file</li>
            <li><strong>Open File:</strong> Ctrl+O to open an existing file</li>
            <li><strong>Run Script:</strong> Press F5 to run the current file</li>
            <li><strong>Run Section:</strong> Ctrl+Enter to run the current cell (delimited by %%)</li>
            <li><strong>Command Window:</strong> Type commands directly in the bottom panel</li>
            <li><strong>Live Scripts:</strong> File &gt; New Live Script for notebook-style editing</li>
          </ul>
        </div>

        <div className="welcome-section">
          <h2>Features</h2>
          <ul className="welcome-tips">
            <li>MATLAB/Octave syntax highlighting and auto-complete</li>
            <li>Workspace variable viewer with inline inspection</li>
            <li>Inline plot rendering and figure management</li>
            <li>File browser with drag-and-drop support</li>
            <li>Light and dark themes (View menu)</li>
            <li>Find &amp; Replace with regex support (Ctrl+H)</li>
          </ul>
        </div>

        <div className="welcome-section">
          <h2>Powered by GNU Octave</h2>
          <p className="welcome-text">
            MatSlop uses GNU Octave as its computation engine.{' '}
            <a
              className="welcome-link"
              href="https://octave.org/doc/interpreter/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Octave Documentation
            </a>
          </p>
        </div>

        <div className="welcome-footer">
          <label className="welcome-checkbox">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            Don&apos;t show this tab on startup
          </label>
          <button className="welcome-close-btn" onClick={handleClose}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}

export default WelcomeTab
