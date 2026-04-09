import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'

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
  private pendingResolve: ((result: CommandResult) => void) | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private status: OctaveEngineStatus = 'disconnected'

  constructor(octavePath: string) {
    super()
    this.octavePath = octavePath
  }

  getStatus(): OctaveEngineStatus {
    return this.status
  }

  start(): void {
    if (this.process) {
      return
    }

    this.process = spawn(this.octavePath, ['--no-gui', '--interactive', '--no-history'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb' }
    })

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
    })

    this.process.on('error', (err) => {
      this.status = 'disconnected'
      this.emit('status', this.status)
      this.emit('error', err)
    })

    // Send initial delimiter to wait for Octave to be ready
    this.setStatus('busy')
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
    // Filter out Octave startup messages and prompt noise
    const lines = data.split('\n')
    const meaningful = lines.filter(
      (line) =>
        !line.startsWith('GNU Octave') &&
        !line.startsWith('Copyright') &&
        !line.includes('warranty') &&
        !line.includes('Octave was configured') &&
        !line.startsWith('>>') &&
        line.trim() !== ''
    )
    if (meaningful.length > 0) {
      this.stderrBuffer += meaningful.join('\n') + '\n'
    }
  }

  private cleanOutput(output: string): string {
    // Remove Octave prompt markers (>> and octave:N>)
    return output
      .split('\n')
      .map((line) => line.replace(/^(octave:\d+> |>> )/, ''))
      .join('\n')
  }

  executeCommand(command: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('Octave process is not running'))
        return
      }

      if (this.pendingResolve) {
        reject(new Error('A command is already running'))
        return
      }

      this.stdoutBuffer = ''
      this.stderrBuffer = ''
      this.setStatus('busy')

      this.pendingResolve = resolve

      // Send the command followed by the delimiter
      this.process.stdin.write(command + '\n')
      this.process.stdin.write(DELIMITER_COMMAND)
    })
  }

  interrupt(): void {
    if (this.process && this.status === 'busy') {
      this.process.kill('SIGINT')
    }
  }

  stop(): void {
    if (this.process) {
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
