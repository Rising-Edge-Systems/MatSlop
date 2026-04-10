import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'

const DELIMITER = '___MATSLOP_CMD_DONE___'
const DELIMITER_COMMAND = `disp('${DELIMITER}')\n`

export interface CommandResult {
  output: string
  error: string
  isComplete: boolean
}

export type OctaveEngineStatus = 'ready' | 'busy' | 'disconnected'

export class OctaveProcessManager extends EventEmitter {
  private process: ChildProcess | null = null
  private octavePath: string
  private scriptsDir: string | null
  private pendingResolve: ((result: CommandResult) => void) | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private status: OctaveEngineStatus = 'disconnected'

  constructor(octavePath: string, scriptsDir: string | null = null) {
    super()
    this.octavePath = octavePath
    this.scriptsDir = scriptsDir
  }

  getStatus(): OctaveEngineStatus {
    return this.status
  }

  start(): void {
    if (this.process) {
      return
    }

    // For bundled/portable Octave, ensure its bin directory is in PATH
    // so it can find its DLLs and dependencies
    const octaveBinDir = path.dirname(this.octavePath)
    const octaveRootDir = path.resolve(octaveBinDir, '..', '..')
    const env = { ...process.env, TERM: 'dumb' }
    // Prepend Octave's bin dir and usr/bin to PATH
    const extraPaths = [
      octaveBinDir,
      path.join(octaveRootDir, 'usr', 'bin')
    ].join(path.delimiter)
    env.PATH = extraPaths + path.delimiter + (env.PATH ?? '')

    this.process = spawn(
      this.octavePath,
      ['--no-gui', '--no-window-system', '--interactive', '--no-history'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: octaveRootDir,
        env
      }
    )

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(data.toString())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      this.handleStderr(data.toString())
    })

    this.process.on('exit', (code, signal) => {
      this.status = 'disconnected'
      this.process = null
      this.emit('status', this.status)
      this.emit('exit', { code, signal })

      // Reject any pending command
      if (this.pendingResolve) {
        this.pendingResolve({
          output: this.stdoutBuffer,
          error: this.stderrBuffer || `Octave process exited (code: ${code}, signal: ${signal})`,
          isComplete: true
        })
        this.pendingResolve = null
        this.stdoutBuffer = ''
        this.stderrBuffer = ''
      }
      // Reject any queued commands
      const queued = this.commandQueue.splice(0)
      for (const q of queued) {
        q.reject(new Error('Octave process exited'))
      }
    })

    this.process.on('error', (err) => {
      this.status = 'disconnected'
      this.emit('status', this.status)
      this.emit('error', err)
    })

    // Send initial setup commands then delimiter to wait for Octave to be ready.
    // - Set gnuplot as graphics toolkit (works headless with --no-window-system)
    // - Suppress graphics toolkit warning messages
    // - Disable pager
    this.setStatus('busy')
    // Escape any single-quotes in the scripts dir for safe embedding in an
    // Octave single-quoted string. Forward slashes are fine on Windows too.
    const scriptsDirForOctave = this.scriptsDir
      ? this.scriptsDir.replace(/\\/g, '/').replace(/'/g, "''")
      : null
    const addpathStmt = scriptsDirForOctave
      ? `try; addpath('${scriptsDirForOctave}'); catch; end;`
      : ''
    const initScript = [
      "warning('off', 'Octave:gnuplot-graphics');",
      "warning('off', 'all');",
      "try; graphics_toolkit('gnuplot'); catch; end;",
      // Force all figures to be invisible — we render them inline in the UI,
      // not as external gnuplot windows.
      "set(0, 'defaultfigurevisible', 'off');",
      "more off;",
      // US-009: put bundled matslop_export_fig on the Octave load path so
      // live-script cells can serialize figures to JSON for PlotRenderer.
      addpathStmt,
    ].filter(Boolean).join(' ')
    this.process.stdin?.write(initScript + '\n')
    this.process.stdin?.write(DELIMITER_COMMAND)

    // Wait for initial ready signal
    this.pendingResolve = () => {
      // Initial ready - discard output
    }
  }

  private setStatus(status: OctaveEngineStatus): void {
    if (this.status !== status) {
      this.status = status
      this.emit('status', status)
    }
  }

  private handleStdout(data: string): void {
    this.stdoutBuffer += data

    // Check if delimiter is in the buffer
    const delimIdx = this.stdoutBuffer.indexOf(DELIMITER)
    if (delimIdx !== -1) {
      // Extract output before the delimiter
      let output = this.stdoutBuffer.substring(0, delimIdx)

      // Clean up Octave prompt markers from output
      output = this.cleanOutput(output)

      this.stdoutBuffer = this.stdoutBuffer.substring(delimIdx + DELIMITER.length)
      // Remove trailing newline after delimiter
      if (this.stdoutBuffer.startsWith('\n')) {
        this.stdoutBuffer = this.stdoutBuffer.substring(1)
      }

      const error = this.stderrBuffer
      this.stderrBuffer = ''

      this.setStatus('ready')

      if (this.pendingResolve) {
        const resolve = this.pendingResolve
        this.pendingResolve = null
        resolve({ output: output.trim(), error: error.trim(), isComplete: true })
      }
    }
  }

  private handleStderr(data: string): void {
    // Filter out Octave startup messages, prompt noise, and third-party
    // debug output (fontconfig via gnuplot writes DEBUG: FC_* lines).
    const lines = data.split('\n')
    const meaningful = lines.filter(
      (line) =>
        !line.startsWith('GNU Octave') &&
        !line.startsWith('Copyright') &&
        !line.includes('warranty') &&
        !line.includes('Octave was configured') &&
        !line.startsWith('>>') &&
        // Fontconfig debug noise (from gnuplot font matching on Windows)
        !line.startsWith('DEBUG: FC_') &&
        !line.startsWith('DEBUG:FC_') &&
        !line.includes("didn't match") &&
        line.trim() !== ''
    )
    if (meaningful.length > 0) {
      this.stderrBuffer += meaningful.join('\n') + '\n'
    }
  }

  private cleanOutput(output: string): string {
    // Remove Octave prompt markers (>> and octave:N>)
    // Strip Octave prompts. Formats seen in the wild:
    //   "octave:42> "  — normal prompt
    //   ">> "          — secondary interactive prompt
    //   "> "           — continuation prompt (multi-line input echoed back)
    // Prompts can appear:
    //   - at the start of a line (after a command echo / continuation)
    //   - at the end of output from fprintf/printf without newlines
    //     (the next prompt gets concatenated onto the same line)
    // Strategy: strip leading prompt(s) per-line, then strip any remaining
    // prompts that got concatenated without newlines.
    const cleanedLines = output.split('\n').map((line) =>
      // Repeatedly strip leading prompts to handle nested continuations
      line.replace(/^(?:octave:\d+>\s*|>>\s*|>\s)+/, '')
    )
    return cleanedLines
      .join('\n')
      // Strip prompts that got glued onto output without a newline boundary
      .replace(/octave:\d+>\s?/g, '')
      .replace(/>>\s?/g, '')
  }

  private commandQueue: Array<{
    command: string
    resolve: (result: CommandResult) => void
    reject: (err: Error) => void
  }> = []

  executeCommand(command: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('Octave process is not running'))
        return
      }

      this.commandQueue.push({ command, resolve, reject })
      this.processQueue()
    })
  }

  private processQueue(): void {
    if (this.pendingResolve) return // command already in flight
    const next = this.commandQueue.shift()
    if (!next) return
    if (!this.process || !this.process.stdin) {
      next.reject(new Error('Octave process is not running'))
      return
    }

    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    this.setStatus('busy')

    this.pendingResolve = (result: CommandResult): void => {
      next.resolve(result)
      // After this command resolves, dispatch the next queued one
      // (handleStdout will null out pendingResolve before calling us)
      setImmediate(() => this.processQueue())
    }

    this.process.stdin.write(next.command + '\n')
    this.process.stdin.write(DELIMITER_COMMAND)
  }

  interrupt(): void {
    if (this.process && this.status === 'busy') {
      this.process.kill('SIGINT')
    }
  }

  stop(): void {
    if (this.process) {
      // Reject any queued commands
      const queued = this.commandQueue.splice(0)
      for (const q of queued) {
        q.reject(new Error('Octave process stopped'))
      }
      this.pendingResolve = null
      this.stdoutBuffer = ''
      this.stderrBuffer = ''
      try {
        this.process.stdin?.write('exit\n')
      } catch {
        // ignore write errors during shutdown
      }
      // Force kill after timeout
      const proc = this.process
      setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // already dead
        }
      }, 2000)
      this.process = null
      this.setStatus('disconnected')
    }
  }

  restart(): void {
    this.stop()
    // Small delay to ensure old process is cleaned up
    setTimeout(() => {
      this.start()
    }, 500)
  }

  isRunning(): boolean {
    return this.process !== null && this.status !== 'disconnected'
  }
}
