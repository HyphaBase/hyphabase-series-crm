import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  agentRules: false,
  // Only for running `next dev` behind another hostname, such as a tunnel: DEV_ORIGINS=crm.example.com
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(","),
};

export default config;
