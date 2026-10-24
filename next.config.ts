import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pipeline reads these at runtime with fs; make sure they ship with every function.
  outputFileTracingIncludes: {
    "/**": ["./config.yaml", "./target_companies.yaml", "./profile/**/*"],
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
