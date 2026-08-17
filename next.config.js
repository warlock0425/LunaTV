/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

// CSP 只放「不需要盤點資源來源」的那幾條，刻意不設 default-src：CSP 的規則是
// 未列出的指令不受限制（只有設了 default-src 才會回退到它），所以這串完全不影響
// 圖片、腳本、樣式的載入，純粹是加固。
//
// 沒有 img-src：processImageUrl 採「直連優先」策略（見 lib/utils.ts），海報是由
// 瀏覽器用觀眾自己的 IP 直接向任意圖床取得的，列不出白名單。原本檔案裡「因為
// images.unoptimized 要允許任意 hostname 所以不加 CSP」的註解只證明了 img-src
// 要放寬，不構成整包不設的理由。
//
// 沒有 script-src：Next.js 會注入行內腳本，要鎖就得改用 nonce，那要動 proxy 並
// 逐頁驗證，成本與風險都是另一個量級，留待日後單獨處理。
const CSP_DIRECTIVES = [
  // 本專案沒有任何 <object>/<embed>，直接關掉這條老舊的外掛攻擊面
  "object-src 'none'",
  // 擋 <base> 注入——被注入後所有相對路徑（含 API 呼叫）都會被導向攻擊者的網域
  "base-uri 'self'",
  // 三個表單都是 onSubmit handler、沒有 action 屬性，鎖同源不影響現有行為，
  // 但能擋下被注入的表單把密碼往外送
  "form-action 'self'",
  // 與既有的 X-Frame-Options: DENY 同義，補給只認 CSP 的瀏覽器
  "frame-ancestors 'none'",
].join('; ');

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

  // 關閉 StrictMode，避免開發模式雙重掛載讓 Artplayer／HLS.js 重複建立
  // 解碼器與 DOM 節點，造成資源洩漏與播放器行為異常。
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

  // 基本 HTTP 安全 headers（CSP 的組成見檔案上方 CSP_DIRECTIVES）
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
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
