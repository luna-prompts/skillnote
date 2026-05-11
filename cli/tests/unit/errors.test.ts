import stripAnsi from 'strip-ansi'
import { describe, expect, it } from 'vitest'
import { UserFacingError, prettyError } from '../../src/ui/errors.js'

describe('prettyError', () => {
  it('renders header only when no body or remediation', () => {
    const out = stripAnsi(prettyError({ header: 'Something broke' }))
    expect(out).toContain('✗')
    expect(out).toContain('Something broke')
  })

  it('includes body lines under the header', () => {
    const out = stripAnsi(
      prettyError({ header: 'Docker is not running', body: 'SkillNote needs Docker to run.' }),
    )
    expect(out).toContain('Docker is not running')
    expect(out).toContain('SkillNote needs Docker to run.')
  })

  it('includes remediation lines below body', () => {
    const out = stripAnsi(
      prettyError({
        header: 'Port in use',
        body: 'Another process is bound to 3000.',
        remediation: ['lsof -i :3000', 'skillnote start --web-port 3001'],
      }),
    )
    expect(out).toContain('lsof -i :3000')
    expect(out).toContain('skillnote start --web-port 3001')
  })

  it('includes docs URL when provided', () => {
    const out = stripAnsi(
      prettyError({
        header: 'Docker missing',
        docsUrl: 'https://docs.docker.com/get-docker/',
      }),
    )
    expect(out).toContain('docs:')
    expect(out).toContain('https://docs.docker.com/get-docker/')
  })

  it('snapshot: full error layout', () => {
    const out = stripAnsi(
      prettyError({
        header: 'Docker is not running',
        body: 'SkillNote needs Docker to run locally.',
        remediation: ['macOS:   open -a Docker', 'Linux:   sudo systemctl start docker'],
        docsUrl: 'https://docs.docker.com/get-docker/',
      }),
    )
    expect(out).toMatchSnapshot()
  })
})

describe('UserFacingError', () => {
  it('carries options through the throw/catch chain', () => {
    try {
      throw new UserFacingError({ header: 'X', body: 'Y' })
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError)
      expect(err).toBeInstanceOf(Error)
      expect((err as UserFacingError).options.header).toBe('X')
      expect((err as UserFacingError).options.body).toBe('Y')
    }
  })
})
