/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

const nextConfig = {
  output: process.platform === 'win32' ? undefined : 'standalone',
  outputFileTracingRoot: __dirname,
  typescript: {
    ignoreBuildErrors: false,
  },

  // 生產環境剝除 client bundle 中冗餘的 console.log / debug，
  // 保留 error 與 warn 以便 HLS.js / Artplayer 等播放器在 F12 仍可提供
  // 網路與解碼問題的診斷訊息；保留 info 供伺服器端營運日誌
  // （如 cron 集數刷新結果）輸出到 docker logs。開發環境不受影響。
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn', 'info'] }
        : false,
  },

  reactStrictMode: false,
  productionBrowserSourceMaps: false,

  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  // Uncomment to add domain whitelist.
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports.
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url.
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/,
      },
      // Convert all other *.svg imports to React components.
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ },
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we handle it above.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },

  // 基本 HTTP 安全 headers（不加 CSP，因為 images.unoptimized 需要允許任意 hostname）
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

module.exports = nextConfig;
