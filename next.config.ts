import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ponytail: cacheComponents off — every screen is per-user and reads the auth cookie,
  // so a prerendered shell buys nothing. Revisit if public/static pages appear.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
