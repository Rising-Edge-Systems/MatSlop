import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import { parsePausedMarker, type PausedLocation } from './debugBridge'

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
  private graphScriptsDir: string | null
  private pendingResolve: ((result: CommandResult) => void) | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private status: OctaveEngineStatus = 'disconnected'

  constructor(
    octavePath: string,
    scriptsDir: string | null = null,
    graphScriptsDir: string | null = null
  ) {
    super()
    this.octavePath = octavePath
    this.scriptsDir = scriptsDir
    this.graphScriptsDir = graphScriptsDir
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
    // OCTAVE_HOME is the install prefix (one level above bin/). Conda-forge
    // binaries on osx-64 carry a 248–258-byte NUL-padded prefix placeholder
    // that, absent this env var, gets read into a std::string with the NULs
    // intact. Concatenating that with "/share/octave/..." keeps c_str()
    // pointing at just the prefix, so `octave::genpath` re-opens the same
    // directory every iteration until the 8MB stack overflows. Setting
    // OCTAVE_HOME bypasses the placeholder entirely.
    const octaveHome = path.dirname(octaveBinDir)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'dumb',
      OCTAVE_HOME: octaveHome,
      OCTAVE_EXEC_HOME: octaveHome,
      // When a user has Anaconda's cmd.exe AutoRun hook set
      // (HKCU\Software\Microsoft\Command Processor\AutoRun pointing at
      // conda_hook.bat), every cmd.exe descendant Octave spawns re-enters
      // the hook and prints "'DOSKEY' is not recognized..." into our
      // captured stdout. The hook's own guard exits early when CONDA_SHLVL
      // is defined, so pre-setting it suppresses the noise without
      // affecting anything else — MatSlop never needs conda aliases inside
      // Octave's subprocesses.
      CONDA_SHLVL: '0',
    }
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
    const toOctavePath = (d: string): string =>
      d.replace(/\\/g, '/').replace(/'/g, "''")
    const addpathStmt = this.scriptsDir
      ? `try; addpath('${toOctavePath(this.scriptsDir)}'); catch; end;`
      : ''
    // The digraph/graph classdef files live in the Octave fork at
    // ../octave/scripts/graph (dev) or resources/octave-scripts/graph
    // (packaged). Adding them to the load path makes MATLAB-style graph
    // code — `G = digraph(s,t); plot(G)` — resolve without the user
    // having to install anything.
    const addpathGraphStmt = this.graphScriptsDir
      ? `try; addpath('${toOctavePath(this.graphScriptsDir)}'); catch; end;`
      : ''
    const initScript = [
      "warning('off', 'Octave:gnuplot-graphics');",
      "warning('off', 'all');",
      "try; graphics_toolkit('gnuplot'); catch; end;",
      // Force all figures to be invisible — we render them inline in the UI,
      // not as external gnuplot windows.
      "set(0, 'defaultfigurevisible', 'off');",
      "more off;",
      // US-B03: On Linux the bundled gnuplot only has cairo-based terminals,
      // so force pngcairo as the default terminal. This ensures -dpng maps
      // to pngcairo and produces valid PNGs without requiring the user to
      // install additional gnuplot terminal packages.
      ...(process.platform === 'linux'
        ? ["setenv('GNUTERM', 'pngcairo');"]
        : []),
      // US-020: enable debug-on-interrupt so SIGINT (from `pauseForDebug()`)
      // drops Octave into the debugger at the currently-executing line
      // rather than just aborting the script. This is the Octave equivalent
      // of MATLAB's "Pause" button for the debugger.
      "try; debug_on_interrupt(true); catch; end;",
      // US-009: put bundled matslop_export_fig on the Octave load path so
      // live-script cells can serialize figures to JSON for PlotRenderer.
      addpathStmt,
      // US-I02: put the Octave fork's scripts/graph dir on the load path
      // so digraph/graph/GraphPlot resolve.
      addpathGraphStmt,
    ].filter(Boolean).join(' ')
    this.process.stdin?.write(initScript + '\n')
    this.process.stdin?.write(DELIMITER_COMMAND)

    // Wait for initial ready signal. Critical: after the init delimiter
    // arrives, drain anything the renderer queued while we were warming up.
    // Without this, an `executeCommand('whos')` issued by the renderer in
    // the same tick as `octave:start` (happens after every HMR reload or
    // fresh launch) sits in `commandQueue` forever because nothing kicks
    // `processQueue()` once the init handler nulls `pendingResolve`.
    this.pendingResolve = (): void => {
      setImmediate(() => this.processQueue())
    }
  }

  private setStatus(status: OctaveEngineStatus): void {
    if (this.status !== status) {
      this.status = status
      this.emit('status', status)
    }
  }

  /**
   * US-016: scan a freshly-received chunk of text for an Octave debug-pause
   * marker and emit a `'paused'` event if one is present. Both stdout and
   * stderr can contain the marker (Octave versions differ), so both handlers
   * call this. Safe to call with any string.
   */
  private maybeEmitPaused(chunk: string): void {
    const loc: PausedLocation | null = parsePausedMarker(chunk)
    if (loc) {
      this.emit('paused', loc)
    }
  }

  private paused = false

  private handleStdout(data: string): void {
    this.stdoutBuffer += data
    const wasPaused = this.paused
    const loc = parsePausedMarker(data)
    if (loc) {
      this.paused = true
      this.emit('paused', loc)
    }

    // Check if delimiter is in the buffer
    const delimIdx = this.stdoutBuffer.indexOf(DELIMITER)
    if (delimIdx !== -1) {
      // If paused at a breakpoint, the delimiter was evaluated at the
      // debug> prompt (not as a normal command completion). Don't resolve
      // the pending command — wait for dbcont to resume, which will
      // produce another delimiter when the script finishes.
      if (this.paused) {
        // Consume the delimiter from the buffer but don't resolve
        this.stdoutBuffer = this.stdoutBuffer.substring(delimIdx + DELIMITER.length)
        if (this.stdoutBuffer.startsWith('\n')) {
          this.stdoutBuffer = this.stdoutBuffer.substring(1)
        }
        return
      }

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

      this.paused = false
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
      const joined = meaningful.join('\n') + '\n'
      this.stderrBuffer += joined
      this.maybeEmitPaused(joined)
    }
  }

  private cleanOutput(output: string): string {
    // Strip ANSI escape sequences (cursor positioning, colors, etc.)
    // Octave outputs these when it detects an interactive terminal.
    // eslint-disable-next-line no-control-regex
    let cleaned = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // Also strip carriage returns that cursor-positioning leaves behind
    cleaned = cleaned.replace(/\r/g, '')

    // Remove Octave prompt markers (>> and octave:N>)
    const cleanedLines = cleaned.split('\n').map((line) =>
      line.replace(/^(?:octave:\d+>\s*|>>\s*|>\s)+/, '')
    )
    return cleanedLines
      .join('\n')
      .replace(/octave:\d+>\s?/g, '')
      .replace(/>>\s?/g, '')
      // Strip debug-mode noise — the UI handles paused state via events.
      // "debug>" prompt, "stopped in X at line N [path]" marker, and the
      // source-line echo that follows it (e.g. "2: y = 2;").
      .replace(/^(?:\[\d+\])?debug>\s*/gm, '')
      .replace(/^stopped in .+ at line \d+.*\n?(?:\d+: .*\n?)?/gm, '')
  }

  private commandQueue: Array<{
    command: string
    resolve: (result: CommandResult) => void
    reject: (err: Error) => void
  }> = []

  /**
   * Write a command directly to Octave's stdin, bypassing the command queue.
   * Used for debug commands (dbcont, dbstep) that must be sent while the
   * previous command is still pending at a debug> prompt.
   */
  /**
   * Write a debug command directly to Octave's stdin. When Octave is paused
   * at a breakpoint, the stdin buffer already contains the pending delimiter
   * (`disp('___MATSLOP_CMD_DONE___')`). The debug prompt reads that as a
   * debug-context command instead of the normal delimiter. So we prepend
   * our command before Octave reads the buffered delimiter, and the
   * sequence becomes: dbcont → (script resumes + finishes) → delimiter
   * is read as a normal command → resolves the pending executeCommand.
   *
   * Actually, Octave reads stdin line-by-line. At `debug>` it reads the
   * NEXT line from the buffer, which is the delimiter. We can't reorder.
   * Instead, we write the command, then write ANOTHER delimiter so the
   * pending executeCommand still resolves.
   */
  /**
   * Send a debug command (dbcont/dbstep) directly to stdin, bypassing the
   * command queue. Returns a promise that resolves with the output produced
   * after the command (e.g. script output after dbcont).
   */
  sendRawCommand(command: string): Promise<CommandResult> {
    return new Promise((resolve) => {
      if (!this.process?.stdin) {
        resolve({ output: '', error: '', isComplete: true })
        return
      }
      this.paused = false
      this.stdoutBuffer = ''
      this.stderrBuffer = ''
      // Install a resolver so the output between dbcont and the delimiter
      // is captured (e.g. the script's disp() output after resuming).
      this.pendingResolve = (result: CommandResult): void => {
        resolve(result)
        setImmediate(() => this.processQueue())
      }
      this.process.stdin.write(command + '\n')
      this.process.stdin.write(DELIMITER_COMMAND)
    })
  }

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

  /**
   * US-020: Pause a running script and drop into the debugger at the
   * currently-executing line. This relies on `debug_on_interrupt(true)`
   * being set during `start()`; sending SIGINT while Octave is executing
   * a script then causes it to enter debug mode at the current line
   * rather than aborting the script. The UI flows just like hitting a
   * breakpoint — the renderer will receive a `'paused'` event via the
   * existing parsePausedMarker pipeline once Octave prints its standard
   * "stopped in <file> at line N" marker.
   *
   * Returns true if a SIGINT was actually sent. No-op and returns false
   * when the process isn't running or isn't busy, so callers can safely
   * invoke it regardless of state.
   */
  pauseForDebug(): boolean {
    if (this.process && this.status === 'busy') {
      this.process.kill('SIGINT')
      return true
    }
    return false
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

      // Detach stderr to suppress Java/JVM crash messages on shutdown
      this.process.stderr?.removeAllListeners('data')
      this.process.stderr?.destroy()

      try {
        this.process.stdin?.write('exit\n')
      } catch {
        // ignore write errors during shutdown
      }
      // Force kill after timeout — use taskkill on Windows to avoid
      // crash dialogs from Java/JVM shutdown
      const proc = this.process
      const pid = proc.pid
      setTimeout(() => {
        try {
          if (process.platform === 'win32' && pid) {
            require('child_process').execSync(
              `taskkill /F /T /PID ${pid}`,
              { stdio: 'ignore', timeout: 3000 }
            )
          } else {
            proc.kill('SIGKILL')
          }
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
