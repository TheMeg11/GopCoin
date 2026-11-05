import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/health", destination: "/api/health" }];
  },
  async headers() {
    return [
      {
        // The HTML shell must never be cached. Next serves prerendered pages with
        // "s-maxage=31536000" by default; Telegram webviews are aggressive caches and a
        // stale document would reference deleted build chunks (old UI or a blank app).
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/art/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        // Basic hardening. NOTE: no frame-ancestors / X-Frame-Options here on purpose —
        // Telegram Web (web.telegram.org) embeds Mini Apps in an iframe, so framing must stay allowed.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer-when-downgrade" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
