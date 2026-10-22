import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets a second test user sign in at http://127.0.0.1:3000 (separate browser storage from localhost).
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Signed-in pages load their data in the browser (the session is in localStorage), so only
    // check instant navigation on segments that opt in with `export const instant = true`.
    instantInsights: { validationLevel: "manual-warning" },
  },
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
