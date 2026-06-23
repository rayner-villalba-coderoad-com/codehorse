import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  //cacheComponents: true
  // Emit a self-contained build (.next/standalone) so the Docker runtime image only
  // needs `node server.js` and a minimal traced node_modules. See the Dockerfile.
  output: "standalone",
  serverExternalPackages: [
    "@langchain/langgraph",
    "@langchain/core",
    "@langchain/google-genai",
    "@langchain/anthropic",
    "@pinecone-database/pinecone",
  ],
  // Prisma's client is generated into lib/generated/prisma (gitignored). Force it into
  // the standalone trace so the PrismaPg driver-adapter client is present at runtime.
  outputFileTracingIncludes: {
    "/**": ["./lib/generated/**"],
  },
};

export default nextConfig;
