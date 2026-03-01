/**
 * E2E: MCP server tests via HTTP — no UI, pure protocol.
 *
 * Tests the full MCP JSON-RPC lifecycle against the live server on port 8083.
 * These are integration tests that hit the real running container.
 */

import { test, expect } from '@playwright/test'

const MCP_URL = 'http://localhost:8083/mcp'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

interface McpSession {
  sessionId: string
}

async function initSession(request: any): Promise<McpSession> {
  const resp = await request.post(MCP_URL, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'playwright-e2e', version: '1.0.0' },
      },
    },
  })
  expect(resp.status()).toBe(200)
  const sessionId = resp.headers()['mcp-session-id']
  expect(sessionId).toBeTruthy()
  return { sessionId }
}

async function mcpPost(request: any, sessionId: string, body: object) {
  const resp = await request.post(MCP_URL, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Mcp-Session-Id': sessionId,
    },
    data: body,
  })
  // Parse SSE-style response: "event: message\ndata: {...}"
  const text = await resp.text()
  const dataLine = text.split('\n').find((l: string) => l.startsWith('data: '))
  expect(dataLine).toBeTruthy()
  return JSON.parse(dataLine!.replace('data: ', ''))
}

// ─── TESTS: INITIALIZE ────────────────────────────────────────────────────────

test.describe('MCP — Initialize', () => {
  test('returns 200 with session ID', async ({ request }) => {
    const resp = await request.post(MCP_URL, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      data: {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      },
    })
    expect(resp.status()).toBe(200)
    expect(resp.headers()['mcp-session-id']).toBeTruthy()
  })

  test('response contains server name SkillNote', async ({ request }) => {
    const resp = await request.post(MCP_URL, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      data: {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      },
    })
    const text = await resp.text()
    expect(text).toContain('SkillNote')
  })

  test('response echoes the protocol version', async ({ request }) => {
    const { sessionId } = await initSession(request)
    // Re-init to check protocol version
    const resp = await request.post(MCP_URL, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId },
      data: {
        jsonrpc: '2.0', id: 2, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      },
    })
    const text = await resp.text()
    expect(text).toContain('2025-03-26')
  })
})

// ─── TESTS: TOOLS LIST ────────────────────────────────────────────────────────

test.describe('MCP — tools/list', () => {
  test('returns array of tools', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(json.result.tools).toBeInstanceOf(Array)
    expect(json.result.tools.length).toBeGreaterThan(0)
  })

  test('each tool has name, description, and inputSchema', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    for (const tool of json.result.tools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  test('skill-creator tool is present', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const names = json.result.tools.map((t: any) => t.name)
    expect(names).toContain('skill-creator')
  })

  test('tools have empty inputSchema.properties (no params required)', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    for (const tool of json.result.tools) {
      expect(tool.inputSchema.properties).toEqual({})
    }
  })

  test('tools/list is consistent across multiple calls', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json1 = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const json2 = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
    const names1 = json1.result.tools.map((t: any) => t.name).sort()
    const names2 = json2.result.tools.map((t: any) => t.name).sort()
    expect(names1).toEqual(names2)
  })
})

// ─── TESTS: TOOLS CALL ────────────────────────────────────────────────────────

test.describe('MCP — tools/call', () => {
  test('calling skill-creator returns markdown content', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'skill-creator', arguments: {} },
    })
    expect(json.result.isError).toBe(false)
    expect(json.result.content).toBeInstanceOf(Array)
    expect(json.result.content[0].type).toBe('text')
    expect(json.result.content[0].text).toContain('# skill-creator')
  })

  test('response content starts with # SkillName heading', async ({ request }) => {
    const { sessionId } = await initSession(request)
    // Get first tool name
    const listJson = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const firstTool = listJson.result.tools[0]

    const json = await mcpPost(request, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: firstTool.name, arguments: {} },
    })
    expect(json.result.content[0].text).toMatch(/^# /)
  })

  test('calling all listed tools returns non-error results', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const listJson = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })

    let callId = 10
    for (const tool of listJson.result.tools) {
      const json = await mcpPost(request, sessionId, {
        jsonrpc: '2.0', id: callId++, method: 'tools/call',
        params: { name: tool.name, arguments: {} },
      })
      expect(json.result.isError).toBe(false)
    }
  })

  test('unknown tool returns isError:true', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'does-not-exist-xyz', arguments: {} },
    })
    expect(json.result.isError).toBe(true)
    expect(json.result.content[0].text).toContain('does-not-exist-xyz')
  })

  test('empty string name returns isError:true — regression for empty-slug bug', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: '', arguments: {} },
    })
    // Before fix: returned first skill. After fix: isError:true
    expect(json.result.isError).toBe(true)
  })

  test('extra arguments are silently ignored', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const json = await mcpPost(request, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'skill-creator', arguments: { unexpected: 'value', foo: 42 } },
    })
    expect(json.result.isError).toBe(false)
  })
})

// ─── TESTS: ERROR HANDLING ────────────────────────────────────────────────────

test.describe('MCP — Error Handling', () => {
  test('malformed JSON returns a JSON-RPC error code', async ({ request }) => {
    const resp = await request.post(MCP_URL, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      data: 'NOT VALID JSON',
    })
    const text = await resp.text()
    // FastMCP returns -32602 (Validation error) for unparse-able input
    expect(text).toMatch(/-326\d\d/)
  })

  test('missing method field returns validation error -32602', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const resp = await request.post(MCP_URL, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId,
      },
      data: { jsonrpc: '2.0', id: 99 },
    })
    const text = await resp.text()
    expect(text).toContain('-32602')
  })

  test('request without session ID returns "Missing session ID" error', async ({ request }) => {
    const resp = await request.post(MCP_URL, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })
    const text = await resp.text()
    expect(text).toContain('session')
  })

  test('concurrent tools/list requests all succeed', async ({ request }) => {
    const { sessionId } = await initSession(request)
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        mcpPost(request, sessionId, { jsonrpc: '2.0', id: 100 + i, method: 'tools/list', params: {} })
      )
    )
    for (const r of results) {
      expect(r.result.tools).toBeInstanceOf(Array)
      expect(r.result.tools.length).toBeGreaterThan(0)
    }
  })
})

// ─── TESTS: LIVE SKILL UPDATES ────────────────────────────────────────────────

test.describe('MCP — Live Skill Discovery', () => {
  test('newly inserted skill appears in tools/list without restart', async ({ request }) => {
    const slug = `e2e-live-${Date.now()}`
    const { sessionId } = await initSession(request)

    // Insert via backend API — slug and name are required separately; name must be lowercase/hyphens
    const createResp = await request.post('http://localhost:8082/v1/skills', {
      headers: { 'Content-Type': 'application/json' },
      data: { name: slug, slug, description: 'E2E live test skill', content_md: '# Live Skill\n\nTest.' },
    })
    expect(createResp.status()).toBe(201)

    // MCP list should now contain it
    const listJson = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const names = listJson.result.tools.map((t: any) => t.name)
    expect(names).toContain(slug)

    // Call it
    const callJson = await mcpPost(request, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: slug, arguments: {} },
    })
    expect(callJson.result.isError).toBe(false)
    expect(callJson.result.content[0].text).toContain('Live Skill')

    // Cleanup
    await request.delete(`http://localhost:8082/v1/skills/${slug}`)
  })

  test('deleted skill disappears from tools/list', async ({ request }) => {
    const slug = `e2e-delete-${Date.now()}`
    const { sessionId } = await initSession(request)

    await request.post('http://localhost:8082/v1/skills', {
      headers: { 'Content-Type': 'application/json' },
      data: { name: slug, slug, description: 'Temp skill', content_md: '# Temp' },
    })

    const before = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(before.result.tools.map((t: any) => t.name)).toContain(slug)

    await request.delete(`http://localhost:8082/v1/skills/${slug}`)

    const after = await mcpPost(request, sessionId, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
    expect(after.result.tools.map((t: any) => t.name)).not.toContain(slug)
  })
})
