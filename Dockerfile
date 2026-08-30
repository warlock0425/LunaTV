# ---- Stage 1: dependencies ----
FROM node:24-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

WORKDIR /app

# pnpm-workspace.yaml 內含 overrides，frozen-lockfile 驗證需要它
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies without running git hooks inside the image build.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- Stage 2: builder ----
FROM node:24-alpine AS builder

RUN apk add --no-cache python3 make g++ libc6-compat

RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DOCKER_ENV=true
ENV NEXT_PUBLIC_STORAGE_TYPE=kvrocks
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=2048"
# Build-time dummy value. Runtime deployments should provide the real KVROCKS_URL.
ENV KVROCKS_URL=redis://localhost:6666

RUN pnpm run build

# ---- Stage 3: runner ----
FROM node:24-alpine AS runner

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DOCKER_ENV=true
# libuv 執行緒池預設只有 4 條，而 dns.lookup 也走這個池。首頁一次載入數十張
# 不同圖床的海報時，慢速 DNS（實測部分圖床要 0.5～1 秒）會把 4 個名額佔滿，
# 連帶阻塞同行程的檔案 I/O、gzip 與 scrypt 密碼驗證，整站因此變卡。
ENV UV_THREADPOOL_SIZE=16

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/start.js ./start.js
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# /api/health 不需認證、不依賴儲存後端，適合當容器健康檢查
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "start.js"]
