import type { NextConfig } from "next";

// Allow LAN access in dev mode: read from env var (set by start_local.sh),
// falling back to common private-network prefixes so any 192.168.x.x / 10.x.x.x works.
const allowedDevOrigins: string[] = process.env.ALLOWED_DEV_ORIGINS
  ? process.env.ALLOWED_DEV_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

const isStandalone = process.env.NEXT_STANDALONE === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins,
  devIndicators: false,
  // Enable standalone output for Electron bundling
  output: isStandalone ? "standalone" : undefined,
  // Electron standalone: skip /_next/image optimizer (returns 400 for /brand-logo.png)
  images: isStandalone ? { unoptimized: true } : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "microphone=*, camera=*, autoplay=*",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: "http://127.0.0.1:8000/:path*",
      },
    ];
  },
};

export default nextConfig;
