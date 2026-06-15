import type { NextConfig } from "next";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // Next.js's dev-mode floating indicator defaults to bottom-left, where it
  // overlaps our sidebar's "Help" link and the mobile nav's first tab. The
  // indicator is dev-only (not rendered in production builds) but devs work
  // here daily — push it to bottom-right where there's nothing to overlap.
  devIndicators: {
    position: 'bottom-right',
  },
  async rewrites() {
    // Proxy the SkillNote backend API through the WEB origin so the connector
    // extension (and any client) can use the SAME URL the user opens in their
    // browser — e.g. http://localhost:3000 — instead of needing to know the
    // backend's port (:8082). The target is server-side and configurable:
    //   - dev (host `npm run dev`): http://localhost:8082 (default)
    //   - Docker: set SKILLNOTE_API_PROXY_TARGET=http://api:8080 (internal)
    const target =
      process.env.SKILLNOTE_API_PROXY_TARGET || 'http://localhost:8082'
    return [
      { source: '/v1/:path*', destination: `${target}/v1/:path*` },
    ]
  },
};

export default nextConfig;
