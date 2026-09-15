/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api",
  },
  // Same-origin tile proxy: the browser only ever talks to us, never to
  // third-party tile hosts directly. The dev/server machine has proven
  // internet while several analyst browsers cannot reach public tile CDNs
  // (corporate proxy / DNS / extension blocking) — proxying removes that
  // whole failure class and keeps attribution intact. No nginx change is
  // needed: `/` already proxies to this frontend, so `/tiles/*` flows
  // through these rewrites on :8080 too.
  async rewrites() {
    return [
      { source: "/tiles/ofm/:path*", destination: "https://tiles.openfreemap.org/:path*" },
      { source: "/tiles/carto/:path*", destination: "https://basemaps.cartocdn.com/:path*" },
      { source: "/tiles/osm/:path*", destination: "https://tile.openstreetmap.org/:path*" },
    ];
  },
};

export default nextConfig;
