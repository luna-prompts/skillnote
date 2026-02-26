import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('adds auth header to requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com', 'skn_test_123')
    await client.get('/health')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer skn_test_123',
        }),
      })
    )
  })

  it('throws on non-ok response with error body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: 'SKILL_NOT_FOUND', message: 'Skill not found' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com', 'skn_test_123')
    await expect(client.get('/v1/skills/nope')).rejects.toThrow('Skill not found')
  })

  it('validates token via POST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, subject: { type: 'user', id: 'me' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com', 'skn_test_123')
    const result = await client.validateToken()
    expect(result).toEqual({ valid: true, subject: { type: 'user', id: 'me' } })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/auth/validate-token',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
