import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  //cacheComponents: true
  serverExternalPackages: [
    "@langchain/langgraph",
    "@langchain/core",
    "@langchain/google-genai",
    "@pinecone-database/pinecone",
  ],
};

export default nextConfig;
