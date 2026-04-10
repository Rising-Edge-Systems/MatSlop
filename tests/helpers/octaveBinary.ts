import path from 'path'
import fs from 'fs'

export function getBundledOctaveBinary(): string {
  const root = path.resolve(__dirname, '..', '..')
  const binPath =
    process.platform === 'win32'
      ? path.join(root, 'resources', 'octave', 'mingw64', 'bin', 'octave-cli.exe')
      : path.join(root, 'resources', 'octave', 'bin', 'octave-cli')
  if (!fs.existsSync(binPath)) {
    throw new Error(`Bundled Octave binary not found at: ${binPath}`)
  }
  return binPath
}
