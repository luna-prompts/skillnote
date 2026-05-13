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
};

export default nextConfig;
