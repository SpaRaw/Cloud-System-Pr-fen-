import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@kw/ui", "@kw/core", "@kw/db"],
  serverExternalPackages: ["mysql2", "ioredis", "@azure/storage-blob", "@azure/storage-queue", "@azure/identity"],
};
export default config;
