<div align="center">
  <img src="public/logo.png" alt="LunaTV Logo" width="120">

  <h1>LunaTV</h1>
  <p><strong>為中文使用者打造的自架影音搜尋與播放介面</strong></p>
  <p>提供流暢的影視聚合搜尋、去廣告播放與響應式觀看體驗。</p>

![Next.js](https://img.shields.io/badge/Next.js-000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-38bdf8?logo=tailwindcss)
![Docker](https://img.shields.io/badge/Docker-2496ed?logo=docker)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey)

</div>

LunaTV 是一個現代化的自架影音聚合平台，基於 **Next.js、TypeScript、Tailwind CSS、ArtPlayer 與 HLS.js** 打造。專案重點在於提供優雅的使用者介面、快速的跨來源搜尋能力以及無廣告的本地播放體驗。

> [!IMPORTANT]
> 本專案不內建播放源，也不託管、上傳或儲存任何影片。部署者必須自行準備合法可用的 CMS/VOD API，並對來源的合法性、安全性與可用性負責。

## 專案特色

- **多來源聚合搜尋**：整合多個 CMS/VOD API，支援跨來源搜尋與結果去重。
- **精準搜尋匹配**：支援繁簡轉換、長標題拆分、別名匹配，提高片源命中率。
- **片源優選與測速排序**：依畫質、載入速度與延遲自動評分，優先顯示高畫質且播放流暢的來源。
- **雲端與本地同步**：支援 Redis、Kvrocks、Upstash 或 localStorage 儲存播放紀錄、收藏與搜尋歷史。
- **進度保護機制**：自動保存觀看進度，避免意外關閉或切換頁面導致紀錄遺失。
- **PWA 行動體驗**：支援安裝到手機桌面，提供接近原生 App 的操作體驗。
- **高品質無廣告播放器**：整合 ArtPlayer 與 HLS.js，支援常見 m3u8/HLS 播放場景，具備 HLS 去廣告過濾、跳過片頭片尾與自動下一集。
- **Docker 友善部署**：提供輕量化映像檔，適合 VPS、NAS 與 Serverless (Vercel) 等多種部署場景。

## 部署方式總覽

| 方式             | 適合對象                     | 優點                         | 建議儲存              |
| ---------------- | ---------------------------- | ---------------------------- | --------------------- |
| Docker Compose   | VPS、NAS、長期自架           | 穩定、可控、更新容易         | Kvrocks 或 Redis      |
| Vercel + Upstash | 不想維護伺服器、輕量個人使用 | 免 VPS、部署快速、Serverless | Upstash Redis         |
| 本機開發與測試   | 開發、修改程式碼             | 方便除錯                     | localStorage 或 Redis |

### Docker Compose 部署 (推薦)

建立 `docker-compose.yml`：

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

啟動：

```bash
docker compose up -d
```

## 播放源設定

部署後系統為預設空殼，必須進入後台設定播放源（CMS/VOD API）才會顯示影音資料。支援標準蘋果 CMS (maccms) API 格式。設定範例如下：

```json
{
  "cache_time": 7200,
  "api_site": {
    "example": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "示例資源"
    }
  },
  "custom_category": [
    {
      "name": "動作電影",
      "type": "movie",
      "query": "動作"
    }
  ]
}
```

## 常見環境變數

| 變數                       | 必填   | 說明                                         |
| -------------------------- | ------ | -------------------------------------------- |
| `USERNAME`                 | 是     | 管理員帳號                                   |
| `PASSWORD`                 | 是     | 管理員密碼，請使用強密碼                     |
| `STORAGE_TYPE`             | 建議   | 後端儲存類型 (`kvrocks`, `redis`, `upstash`) |
| `NEXT_PUBLIC_STORAGE_TYPE` | 建議   | 前端對應儲存類型                             |
| `KVROCKS_URL`              | 視情況 | Kvrocks 連線位址                             |
| `REDIS_URL`                | 視情況 | Redis 連線位址                               |
| `NEXT_PUBLIC_SITE_NAME`    | 否     | 網站名稱，例如 `LunaTV`                      |
| `CRON_SECRET`              | 否     | Vercel 部署必填，用於驗證排程任務的隨機密鑰  |

## 安全與合規聲明

- 本專案僅提供影視資訊搜尋與播放器介面，不內建、不上傳、不儲存任何影片內容。
- 所有播放內容均來自使用者自行設定的第三方來源，請自行確認來源合法性與可用性。
- 因使用者自行設定來源、公開分享、二次分發或部署所產生的風險與責任，由使用者自行承擔。
- 本專案不在特定限制地區提供服務。如有部署或使用，屬個人行為，相關法律風險由使用者自行負責。

## License

[CC BY-NC-SA 4.0](LICENSE) — 姓名標示、非商業性、相同方式分享。禁止商業用途，衍生作品需以相同授權條款釋出。
