export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ValidateTokenResult {
  valid: boolean
  subject?: { type: string; id: string }
  expiresAt?: string
}

export interface SkillListItem {
  name: string
  slug: string
  description: string
  tags: string[]
  collections: string[]
  latestVersion: string | null
  status: string | null
  channel: string | null
}

export interface SkillVersionItem {
  version: string
  checksumSha256: string
  status: string
  channel: string
  publishedAt: string
  releaseNotes: string | null
}

export class ApiClient {
  private baseUrl: string
  private token: string

  constructor(host: string, token: string) {
    this.baseUrl = host.replace(/\/+$/, '')
    this.token = token
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  async validateToken(): Promise<ValidateTokenResult> {
    const res = await fetch(`${this.baseUrl}/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.token }),
    })
    return res.json() as Promise<ValidateTokenResult>
  }

  async downloadBundle(
    skill: string,
    version: string,
  ): Promise<{ buffer: Buffer; checksum: string }> {
    const res = await fetch(`${this.baseUrl}/v1/skills/${skill}/${version}/download`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: res.statusText } }))
      throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? res.statusText)
    }
    const checksum = res.headers.get('X-Checksum-Sha256') ?? ''
    const arrayBuf = await res.arrayBuffer()
    return { buffer: Buffer.from(arrayBuf), checksum }
  }

  async listSkills(): Promise<SkillListItem[]> {
    return this.get<SkillListItem[]>('/v1/skills')
  }

  async listVersions(skill: string): Promise<SkillVersionItem[]> {
    return this.get<SkillVersionItem[]>(`/v1/skills/${skill}/versions`)
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`)
      return res.ok
    } catch {
      return false
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers as Record<string, string>,
        Authorization: `Bearer ${this.token}`,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: res.statusText } }))
      throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? res.statusText)
    }
    return res.json() as Promise<T>
  }
}
