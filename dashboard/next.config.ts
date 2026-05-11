import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  env: {
    CF_WORKER_URL:    process.env.CF_WORKER_URL    ?? "",
    CF_WORKER_SECRET: process.env.CF_WORKER_SECRET ?? "",
  },
};

export default nextConfig;
