import { createInterface } from 'node:readline'
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, saveConfig } from '../config/index.js'
import * as ui from '../util/ui.js'

async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

export async function loginCommand(options: { host?: string }): Promise<void> {
  const host = options.host ?? (await readLine('Host URL: '))
  if (!host) {
    ui.fail('Host URL is required')
    process.exit(1)
  }

  const spin = ui.spinner('Checking backend...')
  spin.start()

  const client = new ApiClient(host.replace(/\/+$/, ''))
  const ok = await client.checkHealth()

  if (!ok) {
    spin.stop()
    ui.fail(`Cannot reach backend at ${host}`)
    process.exit(1)
  }

  const configDir = defaultConfigDir()
  saveConfig(configDir, { host: host.replace(/\/+$/, '') })
  spin.stop()

  ui.success(`Configured to use ${ui.bold(host)}`)
}
