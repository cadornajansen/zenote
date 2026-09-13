import type { NextConfig } from "next"

import { createSecurityHeaders } from "./lib/security-headers"

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: createSecurityHeaders() }]
  },
}

export default nextConfig
