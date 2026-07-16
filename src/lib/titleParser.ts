import { toSearchSimplified } from './chinese';

export function parseChineseNumber(ch: string): number {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (ch === '十') return 10;
  if (ch.length === 2) {
    if (ch[0] === '十') return 10 + (map[ch[1]] || 0);
    if (ch[1] === '十') return (map[ch[0]] || 1) * 10;
  }
  if (ch.length === 3 && ch[1] === '十') {
    return (map[ch[0]] || 0) * 10 + (map[ch[2]] || 0);
  }
  return map[ch] || 0;
}

/**
 * 副標題 → 季數對照（同時收錄繁簡鍵，供 CMS 原文比對）
 * 鍵值刻意保留簡體字元，因下游片名多為簡體。
 */
const SUBTITLE_SEASON_MAP: Record<string, number> = {
  科学与未来: 4,
  科學與未來: 4,
  sciencefuture: 4,
  柱训练: 4,
  柱訓練: 4,
  刀匠村: 3,
  游郭: 2,
  遊郭: 2,
  无限列车: 1,
  無限列車: 1,
  怀玉折玉: 2,
  懷玉折玉: 2,
  涩谷事变: 2,
  澀谷事變: 2,
  终章: 4,
  終章: 4,
  最终季: 4,
  最終季: 4,
  finalseason: 4,
};

export function inferSeasonFromSubtitle(text: string): number | null {
  if (!text) return null;
  const normalized = toSearchSimplified(text)
    .toLowerCase()
    .replace(/[\s\-_]/g, '');
  for (const [sub, season] of Object.entries(SUBTITLE_SEASON_MAP)) {
    const normalizedKey = toSearchSimplified(sub)
      .toLowerCase()
      .replace(/[\s\-_]/g, '');
    if (normalized.includes(normalizedKey)) {
      return season;
    }
  }
  return null;
}

const PART_PATTERN = /\b(?:Part|pt|prat)\s*(\d+)/i;

export function extractPart(text: string): number | null {
  if (!text) return null;

  const normalized = toSearchSimplified(text);

  // 1. 中文部分：第X部分
  const cnMatch = normalized.match(/第([一二三四五六七八九十\d]+)部分/);
  if (cnMatch) {
    const num = cnMatch[1];
    if (/^\d+$/.test(num)) return parseInt(num, 10);
    return parseChineseNumber(num) || null;
  }

  // 2. 英文 Part / pt / prat（CMS 常見拼錯）
  const partMatch = text.match(PART_PATTERN);
  if (partMatch) return parseInt(partMatch[1], 10);

  return null;
}

export function extractSeason(text: string): number | null {
  if (!text) return null;
  const normalized = toSearchSimplified(text);

  // 1. 中文季數：第X季、第X期、第X部（排除「部分」）
  const cnMatch = normalized.match(
    /第([一二三四五六七八九十\d]+)(?:季|期|部(?!分))/
  );
  if (cnMatch) {
    const num = cnMatch[1];
    if (/^\d+$/.test(num)) return parseInt(num, 10);
    return parseChineseNumber(num) || null;
  }

  // 2. 英文 Season 數字
  const seasonMatch = text.match(/Season\s*(\d+)/i);
  if (seasonMatch) return parseInt(seasonMatch[1], 10);

  // 3. S數字（需單詞邊界）
  const sMatch = text.match(/\bS(\d{1,2})\b/i);
  if (sMatch) return parseInt(sMatch[1], 10);

  // 4. Part / pt / prat 數字（部分作品以 Part 當季數標記）
  const partMatch = text.match(PART_PATTERN);
  if (partMatch) return parseInt(partMatch[1], 10);

  // 5. 羅馬數字季數：II … X（避免誤吃單字母 I）
  const romanMatch = text.match(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)\b/i);
  if (romanMatch) {
    const r = romanMatch[1].toUpperCase();
    const map: Record<string, number> = {
      II: 2,
      III: 3,
      IV: 4,
      V: 5,
      VI: 6,
      VII: 7,
      VIII: 8,
      IX: 9,
      X: 10,
    };
    return map[r] || null;
  }

  // 6. 尾部空格／橫線 + 數字（例：史萊姆 4、史萊姆-4）
  const trailingNumMatch = text.match(/[\s\-_](\d+)(?:$|[\s\-_【（(])/);
  if (trailingNumMatch) {
    const num = parseInt(trailingNumMatch[1], 10);
    if (num > 1 && num < 20) return num;
  }

  // 7. 從副標題推導季數
  const inferred = inferSeasonFromSubtitle(text);
  if (inferred !== null) return inferred;

  return null;
}
