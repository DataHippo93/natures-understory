import type { NextConfig } from "next";

// v7.7.5: /wholesale → /lopro/wholesale-pricing. The Wholesale Pricing module
// lives under the /lopro namespace now (alongside future LoPro-store admin
// tooling); the old path is redirected 301 so bookmarks + the previous
// sidebar link keep working.
const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/wholesale',
        destination: '/lopro/wholesale-pricing',
        permanent: true,
      },
      {
        source: '/wholesale/:path*',
        destination: '/lopro/wholesale-pricing/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
