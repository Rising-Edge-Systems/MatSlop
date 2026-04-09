import { useState, useRef, useEffect, useCallback } from 'react'
import PanelHeader from './PanelHeader'
import type { OctaveEngineStatus } from '../App'

interface OutputEntry {
  type: 'command' | 'output' | 'error'
  text: string
}

export interface PendingCommand {
  command: string
  display: string
  id: number
}

interface CommandWindowProps {
  onCollapse: () => void
  engineStatus: OctaveEngineStatus
  pendingCommand?: PendingCommand | null
  onCommandExecuted?: () => void
}

function CommandWindow({ onCollapse, engineStatus, pendingCommand, onCommandExecuted }: CommandWindowProps): React.JSX.Element {
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([])
  const [inputValue, setInputValue] = useState('')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [continuationBuffer, setContinuationBuffer] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new output is added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [outputEntries])

  // Handle pending commands from external sources (e.g., Run button)
  const lastPendingIdRef = useRef<number>(-1)
  useEffect(() => {
    if (!pendingCommand || pendingCommand.id === lastPendingIdRef.current) return
    lastPendingIdRef.current = pendingCommand.id

    // Show the command in output
    setOutputEntries((prev) => [
      ...prev,
      { type: 'command', text: '>> ' + pendingCommand.display },
    ])

    // Execute it
    window.matslop.octaveExecute(pendingCommand.command).then((result) => {
      const newEntries: OutputEntry[] = []
      if (result.output) {
        newEntries.push({ type: 'output', text: result.output })
      }
      if (result.error) {
        newEntries.push({ type: 'error', text: result.error })
      }
      if (newEntries.length > 0) {
        setOutputEntries((prev) => [...prev, ...newEntries])
      }
      onCommandExecuted?.()
    }).catch((err) => {
      setOutputEntries((prev) => [
        ...prev,
        { type: 'error', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ])
      onCommandExecuted?.()
    })
  }, [pendingCommand, onCommandExecuted])

  // Focus input on click anywhere in the panel content
  const handlePanelClick = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  const executeCommand = useCallback(async (command: string) => {
    // Handle clc command locally
    if (command.trim() === 'clc') {
      setOutputEntries([])
      return
    }

    try {
      const result = await window.matslop.octaveExecute(command)
      const newEntries: OutputEntry[] = []
      if (result.output) {
        newEntries.push({ type: 'output', text: result.output })
      }
      if (result.error) {
        newEntries.push({ type: 'error', text: result.error })
      }
      if (newEntries.length > 0) {
        setOutputEntries((prev) => [...prev, ...newEntries])
      }
    } catch (err) {
      setOutputEntries((prev) => [
        ...prev,
        { type: 'error', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ])
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    const trimmed = inputValue.trimEnd()

    // Check for multi-line continuation (ends with ...)
    if (trimmed.endsWith('...')) {
      // Add to continuation buffer, show in output
      const line = trimmed
      setOutputEntries((prev) => [
        ...prev,
        { type: 'command', text: (continuationBuffer ? '   ' : '>> ') + line },
      ])
      setContinuationBuffer((prev) => prev + line.slice(0, -3) + ' ')
      setInputValue('')
      return
    }

    const fullCommand = continuationBuffer + trimmed

    // Show the entered line
    setOutputEntries((prev) => [
      ...prev,
      { type: 'command', text: (continuationBuffer ? '   ' : '>> ') + trimmed },
    ])

    // Clear continuation
    setContinuationBuffer('')
    setInputValue('')

    if (!fullCommand.trim()) return

    // Add to history
    setCommandHistory((prev) => {
      const filtered = prev.filter((c) => c !== fullCommand)
      return [...filtered, fullCommand]
    })
    setHistoryIndex(-1)

    await executeCommand(fullCommand)
  }, [inputValue, continuationBuffer, executeCommand])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
        return
      }

      // Ctrl+C to interrupt
      if (e.key === 'c' && e.ctrlKey && engineStatus === 'busy') {
        e.preventDefault()
        window.matslop.octaveInterrupt()
        setOutputEntries((prev) => [
          ...prev,
          { type: 'error', text: 'Operation interrupted by user.' },
        ])
        return
      }

      // Command history navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (commandHistory.length === 0) return
        const newIndex =
          historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setInputValue(commandHistory[newIndex])
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex === -1) return
        if (historyIndex >= commandHistory.length - 1) {
          setHistoryIndex(-1)
          setInputValue('')
        } else {
          const newIndex = historyIndex + 1
          setHistoryIndex(newIndex)
          setInputValue(commandHistory[newIndex])
        }
        return
      }
    },
    [handleSubmit, engineStatus, commandHistory, historyIndex],
  )

  const promptText = continuationBuffer ? '   ' : '>> '
  const isDisabled = engineStatus === 'disconnected'

  return (
    <div className="panel command-window" onClick={handlePanelClick}>
      <PanelHeader title="Command Window" onCollapse={onCollapse} />
      <div className="cw-output" ref={outputRef}>
        {outputEntries.map((entry, i) => (
          <div key={i} className={`cw-line cw-${entry.type}`}>
            {entry.text}
          </div>
        ))}
        <div className="cw-input-line">
          <span className="cw-prompt">{promptText}</span>
          <input
            ref={inputRef}
            type="text"
            className="cw-input"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value)
              setHistoryIndex(-1)
            }}
            onKeyDown={handleKeyDown}
            disabled={isDisabled}
            placeholder={isDisabled ? 'Octave not connected' : ''}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  )
}

export default CommandWindow
