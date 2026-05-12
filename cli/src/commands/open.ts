import open, { apps } from 'open'
import { loadConfig } from '../state/config.js'
import { c } from '../ui/theme.js'

export interface OpenOptions {
  app?: boolean
  print?: boolean
}

/**
 * Open the SkillNote web UI in the user's browser.
 *
 * --app  : try Chrome/Edge `--app=` mode for a chromeless window. Falls back
 *          to the default browser if no compatible browser is detected.
 * --print: print the URL instead of opening (for CI / non-TTY environments).
 */
export async function openCommand(opts: OpenOptions = {}): Promise<void> {
  const config = await loadConfig()
  const url = `http://localhost:${config.webPort}`

  if (opts.print) {
    process.stdout.write(`${url}\n`)
    return
  }

  if (opts.app) {
    // open's `app` option accepts a Chromium-compatible browser name + arguments.
    try {
      await open(url, {
        app: { name: apps.chrome, arguments: [`--app=${url}`] },
      })
      process.stdout.write(`${c.muted('Opened in app mode:')} ${c.brand(url)}\n`)
      return
    } catch {
      // Fall through to default open.
    }
  }

  // open() can throw on headless systems (no DISPLAY, ssh sessions, WSL2
  // without an X server, CI runners). Catch the rejection and fall back to
  // printing the URL so the user can copy/paste — same end state as `--print`.
  try {
    await open(url)
    process.stdout.write(`${c.muted('Opened:')} ${c.brand(url)}\n`)
  } catch {
    process.stdout.write(
      `${c.muted('Could not open a browser — visit')} ${c.brand(url)} ${c.muted('manually.')}\n`,
    )
  }
}
