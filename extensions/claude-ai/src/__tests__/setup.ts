// Global test setup — installs a chrome.* API mock on globalThis so the
// extension's modules can be loaded under Vitest (which runs in Node).
//
// The mock is intentionally minimal — only the surface area the production
// code actually touches is implemented. New code that uses a new chrome.*
// API needs the corresponding stub added here.

import { beforeEach, vi } from "vitest";

interface CookieValue {
  url: string;
  name: string;
  value: string;
  domain: string;
}

// In-memory cookie jar; tests reset it via resetChromeMocks() below.
const cookieJar: CookieValue[] = [];
const storageBacking = new Map<string, unknown>();

// Listeners registered by code under test.
const cookieListeners: Array<(c: { cookie: { domain: string; name: string }; removed: boolean }) => void> = [];
const storageListeners: Array<(changes: Record<string, unknown>) => void> = [];
const alarmListeners: Array<(a: { name: string }) => void> = [];
const messageListeners: Array<(msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | undefined> = [];

const chromeMock = {
  // ── cookies ──────────────────────────────────────────────────────────────
  cookies: {
    get: vi.fn(async ({ url, name }: { url: string; name: string }) => {
      const match = cookieJar.find(
        (c) => c.url === url && c.name === name,
      );
      return match ?? null;
    }),
    getAll: vi.fn(async ({ domain }: { domain: string }) => {
      return cookieJar.filter((c) => c.domain === domain);
    }),
    onChanged: {
      addListener: vi.fn((fn: typeof cookieListeners[number]) => {
        cookieListeners.push(fn);
      }),
    },
  },

  // ── storage.local ────────────────────────────────────────────────────────
  storage: {
    local: {
      get: vi.fn(async (key: string | string[] | null) => {
        if (key === null || key === undefined) {
          return Object.fromEntries(storageBacking);
        }
        if (Array.isArray(key)) {
          const out: Record<string, unknown> = {};
          for (const k of key) {
            const v = storageBacking.get(k);
            if (v !== undefined) out[k] = v;
          }
          return out;
        }
        const v = storageBacking.get(key);
        return v === undefined ? {} : { [key]: v };
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) storageBacking.set(k, v);
      }),
      remove: vi.fn(async (key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) storageBacking.delete(k);
      }),
      clear: vi.fn(async () => {
        storageBacking.clear();
      }),
    },
    onChanged: {
      addListener: vi.fn((fn: typeof storageListeners[number]) => {
        storageListeners.push(fn);
      }),
    },
  },

  // ── alarms ───────────────────────────────────────────────────────────────
  alarms: {
    create: vi.fn(async (_name: string, _info: { periodInMinutes?: number; when?: number }) => {}),
    clear: vi.fn(async (_name: string) => true),
    onAlarm: {
      addListener: vi.fn((fn: typeof alarmListeners[number]) => {
        alarmListeners.push(fn);
      }),
    },
  },

  // ── notifications ────────────────────────────────────────────────────────
  notifications: {
    create: vi.fn(async (_opts: unknown) => "notif-id"),
  },

  // ── runtime ──────────────────────────────────────────────────────────────
  runtime: {
    getManifest: vi.fn(() => ({ version: "0.1.0-test" })),
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    openOptionsPage: vi.fn(),
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: typeof messageListeners[number]) => {
        messageListeners.push(fn);
      }),
    },
  },

  // ── permissions ──────────────────────────────────────────────────────────
  permissions: {
    request: vi.fn(async (_perms: { origins?: string[] }) => true),
  },
};

(globalThis as any).chrome = chromeMock;

// Reset everything between tests so cookie state from test A doesn't leak
// into test B. The mocks track call history that we also reset.
export function resetChromeMocks(): void {
  cookieJar.length = 0;
  storageBacking.clear();
  cookieListeners.length = 0;
  storageListeners.length = 0;
  alarmListeners.length = 0;
  messageListeners.length = 0;
  vi.clearAllMocks();
}

// Test helpers exposed for individual tests to drive the mock.
export const testHelpers = {
  setCookie(cookie: CookieValue): void {
    cookieJar.push(cookie);
  },
  removeCookie(name: string, domain: string): void {
    const idx = cookieJar.findIndex((c) => c.name === name && c.domain === domain);
    if (idx >= 0) cookieJar.splice(idx, 1);
  },
  fireCookieChange(cookie: { domain: string; name: string }, removed: boolean): void {
    for (const listener of cookieListeners) listener({ cookie, removed });
  },
  fireAlarm(name: string): void {
    for (const listener of alarmListeners) listener({ name });
  },
  fireMessage(msg: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      for (const listener of messageListeners) {
        const isAsync = listener(msg, {}, resolve);
        if (isAsync !== true) resolve(undefined);
      }
    });
  },
  getStorage(key: string): unknown {
    return storageBacking.get(key);
  },
};

// Automatically reset before each test.
beforeEach(() => {
  resetChromeMocks();
});
