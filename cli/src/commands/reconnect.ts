import { type ConnectOptions, connectCommand } from './connect.js'
import { disconnectCommand } from './disconnect.js'

export async function reconnectCommand(agent: string, opts: ConnectOptions = {}): Promise<void> {
  // disconnect is best-effort; if the agent isn't currently installed, we still proceed.
  await disconnectCommand(agent, { yes: true }).catch(() => undefined)
  await connectCommand(agent, opts)
}
