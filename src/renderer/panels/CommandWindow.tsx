import { useState, useRef, useEffect, useCallback } from 'react'
import type { OctaveEngineStatus } from '../App'
import { useOctaveStatus } from '../OctaveContext'
import { useAppContext } from '../AppContext'
import { parseDocCommand, parseHelpCommand } from '../editor/helpDoc'

interface OutputEntry {
  type: 'command' | 'output' | 'error'
  text: string
}

/** Strip Octave debug-mode noise from output before displaying. */
function stripDebugNoise(text: string): string {
  return text
    .replace(/^(?:\[\d+\])?debug>\s*/gm, '')
    .replace(/^stopped in .+ at line \d+.*(?:\n\d+: .*)?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface PendingCommand {
  command: string
  display: string
  id: number
}

interface MenuAction {
  action: string
  id: number
}

interface CommandWindowProps {
  onCollapse: () => void
  engineStatus: OctaveEngineStatus
  pendingCommand?: PendingCommand | null
  onCommandExecuted?: () => void
  onHistoryChanged?: () => void
  pasteCommand?: string | null
  onPasteConsumed?: () => void
  menuAction?: MenuAction | null
  onMenuActionConsumed?: () => void
  /** US-031: intercept `doc <name>` / `help <name>` inputs. */
  onDocCommand?: (topic: string) => void
}

// US-SC04: Type-safe context-to-prop mapping (avoids importing full CtxPendingCommand)
type CtxMenuAction = { action: string; id: number } | null

function CommandWindow({ onCollapse, engineStatus: engineStatusProp, pendingCommand: pendingCommandProp, onCommandExecuted: onCommandExecutedProp, onHistoryChanged: onHistoryChangedProp, pasteCommand: pasteCommandProp, onPasteConsumed: onPasteConsumedProp, menuAction: menuActionProp, onMenuActionConsumed: onMenuActionConsumedProp, onDocCommand: onDocCommandProp }: CommandWindowProps): React.JSX.Element {
  // US-L02: Read from OctaveContext to bypass rc-dock stale prop cache
  const contextStatus = useOctaveStatus()
  const engineStatus = contextStatus !== 'disconnected' ? contextStatus : engineStatusProp
  // US-SC04: Read dynamic state from AppContext (bypasses rc-dock caching)
  const ctx = useAppContext()
  const pendingCommand = (ctx.pendingCommand as PendingCommand | null) ?? pendingCommandProp ?? null
  const pasteCommand = ctx.pasteCommand ?? pasteCommandProp ?? null
  const menuAction: CtxMenuAction = ctx.menuAction ?? menuActionProp ?? null
  const onCommandExecuted = ctx._provided ? ctx.onCommandExecuted : onCommandExecutedProp
  const onDocCommand = ctx._provided ? ctx.onDocCommand : onDocCommandProp
  const onMenuActionConsumed = ctx._provided ? ctx.onMenuActionConsumed : onMenuActionConsumedProp
  const onPasteConsumed = ctx._provided ? ctx.onPasteConsumed : onPasteConsumedProp
  const onHistoryChanged = ctx._provided ? ctx.onHistoryChanged : onHistoryChangedProp
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
      const cleaned = stripDebugNoise(result.output)
      if (cleaned) {
        newEntries.push({ type: 'output', text: cleaned })
      }
      if (result.error) {
        newEntries.push({ type: 'error', text: stripDebugNoise(result.error) })
      }
      if (newEntries.length > 0) {
        setOutputEntries((prev) => [...prev, ...newEntries])
      }
      onCommandExecuted?.()
    window.dispatchEvent(new CustomEvent('matslop:commandExecuted'))
    }).catch((err) => {
      setOutputEntries((prev) => [
        ...prev,
        { type: 'error', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ])
      onCommandExecuted?.()
    window.dispatchEvent(new CustomEvent('matslop:commandExecuted'))
    })
  }, [pendingCommand, onCommandExecuted])

  // Handle paste command from Command History panel
  useEffect(() => {
    if (pasteCommand === null || pasteCommand === undefined) return
    setInputValue(pasteCommand)
    onPasteConsumed?.()
    inputRef.current?.focus()
  }, [pasteCommand, onPasteConsumed])

  // Listen for script run output dispatched by App.tsx handleRunScript/
  // handleRunSection, which bypasses the rc-dock stale-content pipeline.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as {
        display?: string
        output?: string
        error?: string
      }
      const entries: OutputEntry[] = []
      if (detail.display) {
        entries.push({ type: 'output', text: `>> ${detail.display}` })
      }
      if (detail.output) {
        const cleaned = stripDebugNoise(detail.output)
        if (cleaned) entries.push({ type: 'output', text: cleaned })
      }
      if (detail.error) {
        const cleaned = stripDebugNoise(detail.error)
        if (cleaned) entries.push({ type: 'error', text: cleaned })
      }
      if (entries.length > 0) {
        setOutputEntries((prev) => [...prev, ...entries])
      }
    }
    window.addEventListener('matslop:commandOutput', handler)
    return () => window.removeEventListener('matslop:commandOutput', handler)
  }, [])

  // Handle menu actions (e.g., Clear Command Window)
  const lastMenuActionIdRef = useRef(0)
  useEffect(() => {
    if (!menuAction || menuAction.id <= lastMenuActionIdRef.current) return
    lastMenuActionIdRef.current = menuAction.id
    if (menuAction.action === 'clearCommandWindow') {
      setOutputEntries([])
      onMenuActionConsumed?.()
    }
  }, [menuAction, onMenuActionConsumed])

  // Focus input on click anywhere in the panel content, but don't steal
  // focus if the user is selecting text (so copy-from-output works).
  const handlePanelClick = useCallback(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    inputRef.current?.focus()
  }, [])

  const executeCommand = useCallback(async (command: string) => {
    // Handle clc command locally
    if (command.trim() === 'clc') {
      setOutputEntries([])
      return
    }

    // US-031: intercept `doc <name>` / `help <name>` and route to the
    // Help panel instead of forwarding to Octave (which would open an
    // external pager or dump huge output into the command window).
    const docTopic = parseDocCommand(command) ?? parseHelpCommand(command)
    if (docTopic && onDocCommand) {
      onDocCommand(docTopic)
      setOutputEntries((prev) => [
        ...prev,
        { type: 'output', text: `Opened help for ${docTopic} in the Help panel.` },
      ])
      onCommandExecuted?.()
    window.dispatchEvent(new CustomEvent('matslop:commandExecuted'))
      return
    }

    try {
      const result = await window.matslop.octaveExecute(command)
      const newEntries: OutputEntry[] = []
      const cleaned = stripDebugNoise(result.output)
      if (cleaned) {
        newEntries.push({ type: 'output', text: cleaned })
      }
      if (result.error) {
        newEntries.push({ type: 'error', text: stripDebugNoise(result.error) })
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
    onCommandExecuted?.()
    window.dispatchEvent(new CustomEvent('matslop:commandExecuted'))
  }, [onCommandExecuted])

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

    // Persist to disk
    window.matslop.historyAppend(fullCommand).then(() => {
      onHistoryChanged?.()
    })

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
    <div className="panel command-window" data-testid="command-window" onClick={handlePanelClick}>
      <div className="cw-output" ref={outputRef} data-testid="command-output">
        {outputEntries.map((entry, i) => (
          <div key={i} className={`cw-line cw-entry-${entry.type}`}>
            {entry.text}
          </div>
        ))}
        <div className="cw-input-line">
          <span className="cw-prompt">{promptText}</span>
          <input
            ref={inputRef}
            type="text"
            className="cw-input"
            data-testid="command-input"
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
