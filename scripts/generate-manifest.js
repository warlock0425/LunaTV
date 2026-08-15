#!/usr/bin/env node
/* eslint-disable */
// 根據 NEXT_PUBLIC_SITE_NAME 動態生成 manifest.json

const fs = require('fs');
const path = require('path');

// 取得專案根目錄
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const manifestPath = path.join(publicDir, 'manifest.json');

// 從環境變數取得站點名稱
const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'LunaTV';

// manifest.json 模板
const manifestTemplate = {
  id: '/',
  name: siteName,
  short_name: siteName,
  description: '影視聚合',
  lang: 'zh-Hant',
  dir: 'ltr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#000000',
  theme_color: '#000000',
  icons: [
    {
      src: '/icons/icon-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-256x256.png',
      sizes: '256x256',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-384x384.png',
      sizes: '384x384',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
  screenshots: [
    {
      src: '/screenshot1.png',
      sizes: '3828x2012',
      type: 'image/png',
      form_factor: 'wide',
    },
    {
      src: '/screenshot2.png',
      sizes: '3830x2006',
      type: 'image/png',
      form_factor: 'wide',
    },
    {
      src: '/screenshot3.png',
      sizes: '3830x2010',
      type: 'image/png',
      form_factor: 'wide',
    },
  ],
  shortcuts: [
    {
      name: '搜尋',
      url: '/search',
      icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
    },
    {
      name: '觀看記錄',
      url: '/history',
      icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
    },
  ],
};

try {
  // 確保 public 目錄存在
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // 寫入 manifest.json
  fs.writeFileSync(manifestPath, JSON.stringify(manifestTemplate, null, 2));
  console.log(`✅ Generated manifest.json with site name: ${siteName}`);
} catch (error) {
  console.error('❌ Error generating manifest.json:', error);
  process.exit(1);
}
