const fs = require('fs');
const path = require('path');

// 100% 純簡體中文字元集（嚴格排除任何繁簡共用字，防誤報）
const SIMPLIFIED_CHARS = new Set([
  '设',
  '视',
  '网',
  '门',
  '国',
  '会',
  '开',
  '关',
  '无',
  '东',
  '产',
  '剧',
  '场',
  '尝',
  '试',
  '载',
  '录',
  '册',
  '认',
  '缓',
  '确',
  '务',
  '显',
  '库',
  '连',
  '错',
  '误',
  '请',
  '帮',
  '于',
  '记',
  '资',
  '电',
  '结',
  '办',
  '单',
  '弹',
  '个',
  '广',
  '规',
  '选',
  '项',
  '码',
  '时',
  '间',
  '对',
  '应',
  '标',
  '题',
  '简',
  '类',
  '签',
  '筛',
  '询',
  '浏',
  '览',
  '观',
  '传',
  '导',
  '备',
  '复',
  '迁',
  '转',
  '换',
  '验',
  '证',
  '权',
  '组',
  '织',
  '访',
  '问',
  '监',
  '报',
  '统',
  '计',
  '划',
  '调',
  '队',
  '发',
  '负',
  '节',
  '点',
  '级',
  '滚',
]);

const files = process.argv.slice(2);
let hasError = false;

// 排除的檔案或目錄
const EXCLUDED_FILES = [
  's2t.ts',
  'chinese.ts',
  'version.ts',
  'CHANGELOG.md',
  'test-search.js',
  'searchEngine.test.ts',
  'play-search.test.ts',
  'downstream.test.ts',
  'mainland-search.test.ts',
  'play-records.test.ts',
  'titleParser.test.ts',
  'regional-title-aliases.ts',
  'regional-title-aliases.test.ts',
  // 全鏈橋接測試：必須斷言 CMS 簡體／陸譯標題
  'search-regional-bridge.test.ts',
  'playback-regional-bridge.test.ts',
  'search-sort.test.ts',
  'localize-search-result.test.ts',
  // 建議陸名計畫測試：斷言 CMS 簡體／陸譯字串
  'suggestion-queries.test.ts',
  'check-simplified.js',
  // titleParser 需同時收錄繁簡副標題鍵以比對 CMS 原文
  'titleParser.ts',
  // 搜尋比對核心必須同時處理繁簡字串字面量
  'searchEngine.ts',
  // 豆瓣 API 參數鍵（类型/形式/地区）必須為簡體
  'douban/recommends/route.ts',
  // CMS 類型文字為簡體，類型比對需要簡體字面量
  'usePlaybackSourceSearch.ts',
  'play-search.ts',
  // 內容過濾關鍵字需比對 CMS 簡體分類名
  'yellow.ts',
  // 豆瓣 API 參數值（标签/类型/地区選項值）必須為簡體
  'douban.ts',
  'DoubanSelector.tsx',
  // 斷言 toSimplified 的輸出，預期值本來就必須是簡體
  'douban-to-simplified.test.ts',
  // 斷言繁簡轉換與變體生成，輸入與預期值兩邊都必須出現簡體字面量
  'chinese.test.ts',
];

files.forEach((file) => {
  if (!fs.existsSync(file)) return;

  const ext = path.extname(file);
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return;
  if (EXCLUDED_FILES.some((excluded) => file.endsWith(excluded))) return;

  const content = fs.readFileSync(file, 'utf8');

  // 按行檢測
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    // 排除單行與多行註解以避免非代碼干擾
    const cleanLine = line.replace(/\/\/.*$|\/\*[\s\S]*?\*\//g, '').trim();

    const foundSimplfied = [];
    for (let char of cleanLine) {
      if (SIMPLIFIED_CHARS.has(char)) {
        foundSimplfied.push(char);
      }
    }

    if (foundSimplfied.length > 0) {
      console.error(`\n\x1b[31m[ERROR] 檔案 ${file} 中檢測到簡體字：\x1b[0m`);
      console.error(`  第 ${index + 1} 行: ${line.trim()}`);
      console.error(
        `    \x1b[33m檢測到簡體字元: ${Array.from(new Set(foundSimplfied)).join(
          ', '
        )}\x1b[0m`
      );
      hasError = true;
    }
  });
});

if (hasError) {
  console.error(
    '\n\x1b[31m[FAIL] 提交的程式碼中包含簡體字，已被自動攔截！請修正為繁體中文後再提交。\x1b[0m'
  );
  process.exit(1);
} else {
  console.log(
    '\x1b[32m[PASS] 簡體字檢測通過（無簡體字或已排除特定檔案）。\x1b[0m'
  );
}
