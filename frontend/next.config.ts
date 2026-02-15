import type { NextConfig } from "next";

// In production (Vercel) set NEXT_PUBLIC_BACKEND_URL to your Railway backend URL,
// e.g. https://sante-backend.up.railway.app
// Locally it falls back to http://127.0.0.1:8000
const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/token/:path*",
        destination: `${backendUrl}/token/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
