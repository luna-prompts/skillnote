#!/usr/bin/env node
/**
 * Phase 0 spike capture tool.
 *
 * Runs against a HAR file you export from Chrome devtools while
 * interacting with claude.ai's Customize → Skills page. Extracts every
 * request to /api/organizations/.../skills/* and /api/account/skills/*,
 * documents the verified contract, and updates
 * docs/claude-ai-endpoints.md.
 *
 * Usage:
 *   1. Open claude.ai in Chrome, sign in to your Team/Enterprise account.
 *   2. Open devtools → Network → Preserve log.
 *   3. Perform each operation manually (upload, list, delete).
 *   4. Right-click in the Network panel → Save all as HAR with content.
 *   5. Run: node scripts/capture-endpoints.mjs /path/to/claude.har
 *
 * Output: a markdown report at scripts/captured-endpoints.md that the
 * maintainer copies into docs/claude-ai-endpoints.md to replace the
 * provisional "TODO: verify" sections.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const harPath = process.argv[2];
if (!harPath) {
  console.error("Usage: node capture-endpoints.mjs <claude-ai.har>");
  process.exit(1);
}

const har = JSON.parse(readFileSync(harPath, "utf8"));
const entries = har.log?.entries ?? [];

const RELEVANT = /\/api\/(organizations\/[^/]+|account|users\/[^/]+)\/skills?/;

interface Capture {
  method: string;
  url: string;
  status: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBodySample: string;
  responseBodySample: string;
  contentType: string;
}

/** @type {Map<string, Capture>} */
const byPath = new Map();

for (const entry of entries) {
  const url = entry.request.url;
  if (!RELEVANT.test(url)) continue;

  const u = new URL(url);
  const pathKey = `${entry.request.method} ${u.pathname}`;
  if (byPath.has(pathKey)) continue; // first hit only

  const reqHeaders = Object.fromEntries(
    (entry.request.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );
  const resHeaders = Object.fromEntries(
    (entry.response.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );
  // Redact session cookie values — the report stays safe to commit.
  if (reqHeaders.cookie) {
    reqHeaders.cookie = reqHeaders.cookie
      .split(";")
      .map((c) => {
        const [name] = c.trim().split("=");
        return `${name}=<REDACTED>`;
      })
      .join("; ");
  }
  delete reqHeaders.authorization;

  byPath.set(pathKey, {
    method: entry.request.method,
    url: u.pathname + u.search,
    status: entry.response.status,
    requestHeaders: reqHeaders,
    responseHeaders: resHeaders,
    contentType: entry.response.content?.mimeType ?? "",
    requestBodySample: (entry.request.postData?.text ?? "").slice(0, 500),
    responseBodySample: (entry.response.content?.text ?? "").slice(0, 800),
  });
}

const captures = [...byPath.values()].sort((a, b) =>
  a.url.localeCompare(b.url),
);

// Render markdown
let md = `# Claude.ai Endpoints — Captured ${new Date().toISOString()}\n\n`;
md += `Source: ${harPath}\n\n`;
md += `${captures.length} unique endpoint(s) observed.\n\n`;

for (const c of captures) {
  md += `## ${c.method} ${c.url}\n\n`;
  md += `**Status**: ${c.status} · **Content-Type**: ${c.contentType}\n\n`;
  md += `**Request headers** (cookie values redacted):\n\n\`\`\`http\n`;
  for (const [k, v] of Object.entries(c.requestHeaders)) {
    md += `${k}: ${v}\n`;
  }
  md += `\`\`\`\n\n`;
  if (c.requestBodySample) {
    md += `**Request body sample**:\n\n\`\`\`\n${c.requestBodySample}\n\`\`\`\n\n`;
  }
  md += `**Response headers**:\n\n\`\`\`http\n`;
  for (const [k, v] of Object.entries(c.responseHeaders)) {
    md += `${k}: ${v}\n`;
  }
  md += `\`\`\`\n\n`;
  if (c.responseBodySample) {
    md += `**Response body sample**:\n\n\`\`\`\n${c.responseBodySample}\n\`\`\`\n\n`;
  }
  md += `---\n\n`;
}

const out = resolve(__dirname, "captured-endpoints.md");
writeFileSync(out, md);
console.log(`Wrote ${out}`);
console.log(`Endpoints captured: ${captures.length}`);
console.log(`\nReview this file and update docs/claude-ai-endpoints.md +`);
console.log(`extensions/claude-ai/src/lib/claude-ai-client.ts with the verified paths.`);
