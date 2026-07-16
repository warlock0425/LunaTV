# ---- Stage 1: dependencies ----
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# Install dependencies without running git hooks inside the image build.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- Stage 2: builder ----
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ libc6-compat

RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DOCKER_ENV=true
ENV NEXT_PUBLIC_STORAGE_TYPE=kvrocks
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=768"
# Build-time dummy value. Runtime deployments should provide the real KVROCKS_URL.
ENV KVROCKS_URL=redis://localhost:6666

RUN pnpm run build

# ---- Stage 3: runner ----
FROM node:20-alpine AS runner

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DOCKER_ENV=true

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/start.js ./start.js
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# /api/server-config 不需認證（middleware 已排除），適合當健康檢查端點
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/server-config || exit 1

CMD ["node", "start.js"]
