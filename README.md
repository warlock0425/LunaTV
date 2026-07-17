<div align="center">
  <img src="public/logo.png" alt="LunaTV Logo" width="120">

  <h1>LunaTV</h1>
  <p><strong>為中文使用者打造的自架影音聚合搜尋與播放平台</strong></p>
  <p>跨來源聚合搜尋・智慧片源優選・無廣告 HLS 播放・IPTV 直播・雲端進度同步</p>

![Version](https://img.shields.io/badge/Version-2.5.6-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-38bdf8?logo=tailwindcss)
![Node](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs)
![Docker](https://img.shields.io/badge/Docker-multi--arch-2496ed?logo=docker)
![CI](https://github.com/Berserker8888/LunaTV/actions/workflows/docker-image.yml/badge.svg)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey)

</div>

LunaTV 是一個現代化的自架影音聚合平台。它本身**不提供任何影音內容**——你把自己合法可用的
CMS/VOD API 接進來，它負責把「搜尋、挑源、播放、記錄」這整條體驗做到極致：一次搜尋打遍所有來源、
自動測速挑出最快最清晰的片源、無廣告播放、跨裝置同步觀看進度。

> [!IMPORTANT]
> 本專案不內建播放源，也不託管、上傳或儲存任何影片。部署後為空殼狀態，
> 必須由部署者自行設定合法可用的 CMS/VOD API 才會有內容。
> 來源的合法性、安全性與可用性由部署者自行負責。

## 目錄

- [功能特色](#功能特色)
- [系統架構](#系統架構)
- [快速開始](#快速開始)
- [播放源設定](#播放源設定)
- [環境變數](#環境變數)
- [本機開發](#本機開發)
- [工程品質](#工程品質)
- [安全與合規聲明](#安全與合規聲明)
- [致謝](#致謝)

## 功能特色

### 搜尋與探索

- **多來源聚合搜尋**——同時查詢所有已設定的 CMS/VOD API，串流回傳結果並即時去重，支援聚合檢視與逐源檢視兩種模式
- **繁簡智慧匹配**——內建繁簡轉換、長標題拆分、副標題解析與 Bangumi 別名匹配，台灣譯名也能精準命中大陸片源
- **豆瓣 / Bangumi 探索頁**——電影、劇集、動漫（含每日放送）、綜藝分類瀏覽，支援自訂分類；中繼資料經由 CDN 代理分流，不對來源站造成集中壓力
- **來源熔斷保護**——連續失敗的片源自動進入冷卻期，避免壞源拖慢整體搜尋

### 播放體驗

- **無廣告 HLS 播放**——ArtPlayer + hls.js，自訂 Loader 在 M3U8 層精準過濾廣告切片
- **片源優選**——對候選片源並行測速（畫質、載入速度、延遲）自動排序，一鍵換源並無縫接續進度
- **追劇利器**——跳過片頭片尾（可逐劇記憶設定）、自動連播倒數、集數記憶、斷點續播
- **完整快捷鍵**——空白鍵播放暫停、方向鍵快進音量、`[` `]` 倍速、`F` 全螢幕、`P` 子母畫面、`?` 查看全部
- **行動端最佳化**——觸控手勢（滑動快進、音量、亮度）、長按選單、PWA 可安裝到主畫面

### IPTV 直播

- **M3U 直播源**——匯入標準 M3U/M3U8 播放清單，頻道自動分組
- **EPG 節目單**——支援 XMLTV 格式電子節目表，當日節目自動清洗去重、捲動跟隨正在播放的節目

### 資料與同步

- **四種儲存後端**——Kvrocks（推薦）/ Redis / Upstash Redis / 瀏覽器 localStorage，觀看記錄、收藏、搜尋歷史跨裝置同步
- **集數自動更新**——內建 cron 每小時刷新追蹤中劇集的最新集數，狀態可在後台健康頁檢視
- **資料遷移**——後台一鍵匯出／匯入全部使用者資料

### 管理後台

- **視覺化片源管理**——新增、排序（拖曳）、批次啟停、有效性驗證
- **多使用者**——帳號管理與角色權限（站長 / 管理員 / 使用者）
- **站點設定**——站名、公告、搜尋頁數上限、內容過濾開關、豆瓣代理策略
- **設定訂閱**——支援遠端設定檔訂閱與自動更新

## 系統架構

```
┌─────────────────────────────────────────────────────┐
│                    Browser (PWA)                    │
│   Next.js App Router UI ・ ArtPlayer ・ hls.js      │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Next.js 16 (Node.js 24)                │
│  proxy.ts 全域認證 ・ API Routes ・ 內建 cron        │
│  搜尋聚合 / 測速優選 / M3U8 廣告過濾 / 圖片代理      │
└──────┬────────────────────────────┬─────────────────┘
       │                            │
┌──────▼──────┐            ┌────────▼────────┐
│ 儲存後端     │            │ 外部來源（自行設定）│
│ Kvrocks /   │            │ CMS/VOD API      │
│ Redis /     │            │ M3U 直播源        │
│ Upstash /   │            │ 豆瓣 / Bangumi   │
│ localStorage│            │ （中繼資料）      │
└─────────────┘            └──────────────────┘
```

| 層面   | 技術                                                       |
| ------ | ---------------------------------------------------------- |
| 框架   | Next.js 16（App Router）、React 19、TypeScript 5.9         |
| 樣式   | Tailwind CSS 3                                             |
| 播放器 | ArtPlayer 5、hls.js（按需載入，非播放頁不佔用初始 bundle） |
| 認證   | 全域 Proxy 攔截 + 簽名 Cookie 會話（密碼加鹽雜湊儲存）     |
| 儲存   | Kvrocks / Redis / Upstash / localStorage 四後端同一介面    |
| 部署   | Docker multi-arch（amd64 / arm64）、Node.js 24             |

## 快速開始

### Docker Compose（推薦）

適合 VPS、NAS 等長期自架場景。建立 `docker-compose.yml`：

```yaml
services:
  lunatv:
    image: ghcr.io/berserker8888/lunatv:latest
    container_name: lunatv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=請改成你的強密碼
      - STORAGE_TYPE=kvrocks
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://kvrocks:6666
      - NEXT_PUBLIC_SITE_NAME=LunaTV
    depends_on:
      - kvrocks
    networks:
      - lunatv

  kvrocks:
    image: apache/kvrocks:latest
    container_name: lunatv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks
    networks:
      - lunatv

networks:
  lunatv:

volumes:
  kvrocks-data:
```

```bash
docker compose up -d        # 啟動
docker compose pull && docker compose up -d   # 更新到最新版
```

容器內建 `HEALTHCHECK`，可搭配 Watchtower 等工具自動更新。

### Vercel + Upstash（免伺服器）

1. Fork 本倉庫後在 Vercel 匯入專案
2. 建立 [Upstash Redis](https://upstash.com/) 資料庫
3. 設定環境變數：`USERNAME`、`PASSWORD`、`STORAGE_TYPE=upstash`、
   `NEXT_PUBLIC_STORAGE_TYPE=upstash`、`UPSTASH_URL`、`UPSTASH_TOKEN`、`CRON_SECRET`
4. 部署完成後於 `vercel.json` 的排程即會自動刷新集數

### 部署方式對照

| 方式             | 適合對象             | 儲存建議                |
| ---------------- | -------------------- | ----------------------- |
| Docker Compose   | VPS、NAS、長期自架   | Kvrocks（輕量）或 Redis |
| Vercel + Upstash | 不想維護伺服器的個人 | Upstash Redis           |
| 本機開發         | 開發與除錯           | localStorage 或 Redis   |

## 播放源設定

部署後系統為**空殼狀態**。登入後進入 `管理面板 → 影片來源` 設定播放源，支援標準蘋果 CMS
（maccms）API 格式。三種設定方式：

1. **後台逐筆新增**——在管理面板直接填入 API 位址
2. **設定檔貼上**——在 `管理面板 → 設定檔` 貼上 JSON（格式如下）
3. **訂閱網址**——填入遠端設定檔 URL，支援自動更新

```json
{
  "cache_time": 7200,
  "api_site": {
    "example": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "示例資源",
      "detail": "https://example.com"
    }
  },
  "custom_category": [{ "name": "動作電影", "type": "movie", "query": "動作" }]
}
```

也可在容器掛載 `config.json`（或以 `CONFIG_FILE_PATH` 指定路徑）作為首次啟動的預設設定。

## 環境變數

### 基本

| 變數                            | 必填   | 說明                                                           |
| ------------------------------- | ------ | -------------------------------------------------------------- |
| `USERNAME`                      | 是     | 站長帳號                                                       |
| `PASSWORD`                      | 是     | 站長密碼（請使用強密碼；未設定時全站顯示警告頁）               |
| `STORAGE_TYPE`                  | 建議   | 伺服器端儲存：`kvrocks` / `redis` / `upstash` / `localstorage` |
| `NEXT_PUBLIC_STORAGE_TYPE`      | 建議   | 前端對應儲存類型，需與上者一致                                 |
| `KVROCKS_URL`                   | 視情況 | Kvrocks 連線位址，如 `redis://kvrocks:6666`                    |
| `REDIS_URL`                     | 視情況 | Redis 連線位址                                                 |
| `UPSTASH_URL` / `UPSTASH_TOKEN` | 視情況 | Upstash REST 端點與金鑰                                        |
| `NEXT_PUBLIC_SITE_NAME`         | 否     | 網站名稱（預設 `BerserkerTV`）                                 |
| `ANNOUNCEMENT`                  | 否     | 站點公告內容                                                   |

### 進階

| 變數                                                           | 預設                    | 說明                                 |
| -------------------------------------------------------------- | ----------------------- | ------------------------------------ |
| `CONFIG_FILE_PATH`                                             | `./config.json`         | 首次初始化用的設定檔路徑             |
| `CRON_SECRET`                                                  | —                       | 排程端點驗證密鑰（Vercel 部署必填）  |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE`                                  | `5`                     | 每個來源搜尋的最大頁數               |
| `NEXT_PUBLIC_FLUID_SEARCH`                                     | `true`                  | 串流式搜尋輸出（邊搜邊顯示）         |
| `NEXT_PUBLIC_DISABLE_YELLOW_FILTER`                            | `false`                 | 停用成人內容分類過濾                 |
| `NEXT_PUBLIC_DOUBAN_PROXY_TYPE`                                | `cmliussss-cdn-tencent` | 豆瓣資料代理策略                     |
| `NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE`                          | `cmliussss-cdn-tencent` | 豆瓣圖片代理策略                     |
| `BANGUMI_ACCESS_TOKEN`                                         | —                       | Bangumi API 憑證（提高別名查詢限額） |
| `SEARCH_CACHE_TTL_MINUTES`                                     | `120`                   | 伺服器端搜尋快取時間                 |
| `SOURCE_BREAKER_THRESHOLD` / `SOURCE_BREAKER_COOLDOWN_MINUTES` | —                       | 來源熔斷的失敗閾值與冷卻時間         |

## 本機開發

需求：Node.js ≥ 20.9（建議 24）、pnpm ≥ 10。

```bash
pnpm install          # 安裝相依
pnpm dev              # 開發伺服器（http://localhost:3000）
pnpm build            # 產線建置
pnpm lint             # ESLint 檢查
pnpm typecheck        # TypeScript 型別檢查
pnpm test             # Jest 單元測試
pnpm test:coverage    # 覆蓋率報告（門檻防倒退）
pnpm test:e2e         # Playwright 端對端測試（建置 + 雙裝置模擬）
```

專案結構速覽：

```
src/
├── app/            # App Router 頁面與 API Routes
│   ├── play/       # 點播播放頁（播放器核心、選集、換源）
│   ├── live/       # IPTV 直播頁（頻道、EPG）
│   ├── admin/      # 管理後台
│   └── api/        # 搜尋聚合、詳情、代理、cron 等端點
├── components/     # 共用 UI 元件
├── hooks/          # 共用 React hooks
└── lib/            # 核心邏輯（搜尋引擎、儲存抽象、繁簡轉換、測速）
```

## 工程品質

- **靜態把關**——TypeScript strict、ESLint 9 flat config，並全面啟用
  eslint-plugin-react-hooks 的 React Compiler 前置規則（`set-state-in-effect`、`purity` 等）
- **測試**——300+ Jest 單元測試（含 Testing Library 元件測試）+ Playwright E2E
  （桌面與行動雙環境，覆蓋登入、播放、導覽核心流程），覆蓋率門檻於 CI 防倒退
- **提交管線**——husky + lint-staged + commitlint（Conventional Commits），
  另含簡體字檢查確保介面用語一致為繁體中文
- **CI/CD**——GitHub Actions 於每次推送執行品質檢查與 E2E，
  通過後建置 amd64/arm64 雙架構映像推送至 GHCR
- **相依安全**——pnpm overrides 集中管理（`pnpm-workspace.yaml`），已知漏洞歸零

## 安全與合規聲明

- 本專案僅提供影視資訊**搜尋與播放器介面**，不內建、不上傳、不儲存任何影片內容
- 所有播放內容均來自使用者自行設定的第三方來源，請自行確認來源的合法性與可用性
- 因使用者自行設定來源、公開分享、二次分發或部署所產生的風險與責任，由使用者自行承擔
- 本專案不在特定限制地區提供服務。如有部署或使用，屬個人行為，相關法律風險由使用者自行負責
- 全站受密碼保護，請務必設定強密碼並避免將站點公開分享

## 致謝

本專案基於 [MoonTechLab/LunaTV](https://github.com/MoonTechLab/LunaTV) 二次開發，
針對繁體中文使用者深度在地化，並持續進行架構現代化與功能強化。感謝原作者及所有上游貢獻者。

## License

[CC BY-NC-SA 4.0](LICENSE) — 姓名標示、非商業性、相同方式分享。
禁止商業用途，衍生作品需以相同授權條款釋出。
