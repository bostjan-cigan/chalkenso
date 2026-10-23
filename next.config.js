const createNextIntlPlugin = require('next-intl/plugin');

/** Translations (next-intl): each render's language and words come from src/i18n/request.ts. */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** The edition, decided once at build time (src/lib/site.ts reads it as `CHALKENSO_EDITION`). */
let edition = 'local';

/** Build-time settings only the cloud edition has (none in the public repository). */
const cloudEnv = {};
let withCloud = (config) => config;

/** Routes of the cloud edition's developer docs and website API (none in the public repository). */
const websiteRewrites = [];
const websiteRedirects = [];
const websiteFiles = {};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This folder is the project, whatever lockfiles sit around it (both are Next's own guesses otherwise).
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  // The Docker image runs Next's standalone server (see Dockerfile).
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  env: {
    CHALKENSO_EDITION: edition,
    ...cloudEnv,
  },
  experimental: {
    optimizePackageImports: ['react-icons'],
  },
  // `next dev --webpack` only (Turbopack ignores this). Next turns on webpack's
  // `experiments.cacheUnaffected`, whose per-module memory caches keep module graph connections
  // from earlier compilations, and through them every earlier compilation: the dev server grew by
  // ~200 MB per compiled route until Next restarted it mid-test. Without it, old compilations go.
  webpack(config, { dev }) {
    if (dev) config.experiments = { ...config.experiments, cacheUnaffected: false };
    return config;
  },
  images: {
    //unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'vercel.com',
      },
    ],
    minimumCacheTTL: 60 * 60 * 24 * 7, // Cache for 7 days
    formats: ['image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  async rewrites() {
    return websiteRewrites;
  },
  async redirects() {
    return [
      // The local edition is just the app: its home is signing in (signed-in people go on to the app).
      ...(edition === 'local' ? [{ source: '/', destination: '/admin/login', permanent: false }] : []),
      ...websiteRedirects,
    ];
  },
  outputFileTracingIncludes: websiteFiles,
  async headers() {
    return [
      {
        source: '/assets/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

module.exports = withCloud(withNextIntl(nextConfig));
