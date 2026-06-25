import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is reached over the LAN (and the VPN squats on localhost),
  // so allow these origins to load the /_next dev resources — otherwise the JS
  // bundles are blocked and the page renders but can't hydrate (nothing clicks).
  allowedDevOrigins: [
    "192.168.254.122",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
