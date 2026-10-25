import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pipeline reads these at runtime with fs; make sure they ship with every function.
  outputFileTracingIncludes: {
    "/**": ["./config.yaml", "./target_companies.yaml", "./profile/**/*"],
  },
  // Private tool: keep every page and API response out of search engines.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }];
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
