import type { NextConfig } from "next";

const config: NextConfig = {
  // The demo runs the real domain package in the browser; UI primitives ship as source.
  transpilePackages: ["@apotek/domain", "@apotek/ui"],
};

export default config;
