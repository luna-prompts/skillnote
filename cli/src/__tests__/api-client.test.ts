import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('makes requests without auth headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com')
    await client.get('/health')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/health',
      expect.objectContaining({
        method: 'GET',
      })
    )
    // Should NOT have Authorization header
    const callArgs = mockFetch.mock.calls[0][1]
    expect(callArgs.headers?.Authorization).toBeUndefined()
  })

  it('throws on non-ok response with error body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: 'SKILL_NOT_FOUND', message: 'Skill not found' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com')
    await expect(client.get('/v1/skills/nope')).rejects.toThrow('Skill not found')
  })

  it('checks health via GET', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com')
    const result = await client.checkHealth()
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/health')
  })
})
