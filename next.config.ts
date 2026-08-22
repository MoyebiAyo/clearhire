import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mammoth/unpdf are CommonJS packages with dynamic requires; keep them
  // external so the Next.js server bundles them as-is.
  serverExternalPackages: ["mammoth", "unpdf"],
};

export default nextConfig;
