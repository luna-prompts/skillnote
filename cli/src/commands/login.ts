import { createInterface } from 'node:readline'
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, saveConfig } from '../config/index.js'
import * as ui from '../util/ui.js'

async function readLineHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    let input = ''
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')
    const onData = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(input)
      } else if (ch === '\u0003') {
        process.exit(1)
      } else if (ch === '\u007f' || ch === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        input += ch
        process.stdout.write('*')
      }
    }
    process.stdin.on('data', onData)
  })
}

async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

export async function loginCommand(options: { host?: string; token?: string }): Promise<void> {
  const host = options.host ?? (await readLine('Host URL: '))
  if (!host) {
    ui.fail('Host URL is required')
    process.exit(1)
  }

  const token = options.token ?? (await readLineHidden('Token: '))
  if (!token) {
    ui.fail('Token is required')
    process.exit(1)
  }

  const spin = ui.spinner('Validating token...')
  spin.start()

  const client = new ApiClient(host.replace(/\/+$/, ''), token)
  const result = await client.validateToken()

  if (!result.valid) {
    spin.stop()
    ui.fail('Token is invalid or expired')
    process.exit(1)
  }

  const configDir = defaultConfigDir()
  saveConfig(configDir, { host: host.replace(/\/+$/, ''), token })
  spin.stop()

  const subject = result.subject
  ui.success(`Logged in to ${ui.bold(host)} as ${subject?.type ?? 'user'} (${subject?.id ?? 'unknown'})`)
}
