/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // small Docker image; ignored by Vercel
  poweredByHeader: false,
  reactStrictMode: true,
  // Native SQLite bindings must be loaded by Node at runtime, not bundled.
  serverExternalPackages: ['@libsql/client', 'libsql'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // The microphone is the whole point of the app — allow it for our own origin only.
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
