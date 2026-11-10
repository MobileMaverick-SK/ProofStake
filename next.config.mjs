/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native module: must be loaded by Node at runtime, not bundled.
  serverExternalPackages: ['better-sqlite3', '@paypal/agent-toolkit'],
  devIndicators: false,
};

export default nextConfig;
