import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components (PPR/dynamicIO) is off: every route here is auth-gated
  // and reads cookies via getClaims(), so the app renders dynamically.
  // Re-enable with explicit <Suspense> boundaries if partial prerender is
  // ever needed.
  cacheComponents: false,
  // `sharp` is a native module; keep it out of the bundler so its prebuilt
  // libvips binary loads correctly in the Node server runtime.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
