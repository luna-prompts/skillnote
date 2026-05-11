import { type StartOptions, startCommand } from './start.js'
import { stopCommand } from './stop.js'

export async function restartCommand(opts: StartOptions = {}): Promise<void> {
  await stopCommand()
  await startCommand(opts)
}
