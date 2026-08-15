/**
 * LunaTV 智慧搜尋與繁簡容錯核心引擎
 *
 * isFuzzyMatch 採用 hybrid 比對策略：
 *   1. 精確／互相包含（含長度差護欄）
 *   2. 最長公共子字串（contiguous substring）為主路徑，防散落同字誤配
 *   3. 最長公共子序列（subsequence）僅在已有足夠連續核心時作輔助放寬
 * 以上均不滿足則視為不匹配，降低「點 A 搜出 B」風險。
 */
import { generateSearchVariants } from './chinese';
import { getRegionalMainlandTitles } from './regional-title-aliases';
import { convertT2S } from './s2t';
import { extractPart, extractSeason } from './titleParser';

const SPECIAL_TITLE_KEYWORDS = [
  '特別篇',
  '特别篇',
  '外傳',
  '外传',
  '番外篇',
  '番外',
  '劇場版',
  '剧场版',
  '電影',
  '电影',
  '總集篇',
  '总集篇',
  '日記',
  '日记',
  '紅蓮之絆',
  '红莲之绊',
  '蒼海之淚',
  '苍海之泪',
  'ova',
  'oad',
];

/**
 * 最長公共子字串長度（Longest Common Substring，必須連續）
 */
function getLongestCommonSubstring(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  let longest = 0;
  // 滾動一列 DP，O(min(n,m)) 額外空間
  let prev = new Array(s2.length + 1).fill(0);
  let curr = new Array(s2.length + 1).fill(0);
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > longest) longest = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return longest;
}

/**
 * 最長公共子序列長度（Longest Common Subsequence，允許不連續）
 * 僅作輔助：必須搭配足夠長的連續核心，避免散落同字誤配。
 */
function getLongestCommonSubsequence(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  // 滾動一列 DP
  let prev = new Array(s2.length + 1).fill(0);
  let curr = new Array(s2.length + 1).fill(0);
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[s2.length];
}

/** 兼容舊內部名稱：以子字串為主（評分／早期門檻） */
function getLCS(s1: string, s2: string): number {
  return getLongestCommonSubstring(s1, s2);
}

function getCoverageDenominator(lenA: number, lenB: number): number {
  const minLen = Math.min(lenA, lenB);
  const maxLen = Math.max(lenA, lenB);
  // 長度差較大時多半是副標題／截斷，改以短字串為分母避免過度嚴苛
  return maxLen - minLen > 3 ? minLen : maxLen;
}

/**
 * Hybrid 覆蓋判斷：
 * - 主路徑：連續子字串覆蓋達標（精準、抗散落同字）
 * - 輔助：在已有足夠長連續核心（>=4）時，用子序列微幅放寬門檻
 *   避免「成龍歷險記 / 龍珠歷險記」這類僅共享部分字根的誤配
 */
function passesHybridCoverage(
  a: string,
  b: string,
  ratioRequired: number
): boolean {
  if (a.length < 4 || b.length < 4) return false;

  const substr = getLongestCommonSubstring(a, b);
  if (substr < 4) return false;

  const subseq = getLongestCommonSubsequence(a, b);
  const minLen = Math.min(a.length, b.length);
  const denominator = getCoverageDenominator(a.length, b.length);
  if (denominator <= 0) return false;

  // 主路徑：連續匹配覆蓋達標
  if (substr / denominator >= ratioRequired) {
    return true;
  }

  // 輔助：連續核心夠強，且子序列幾乎覆蓋短字串（容忍中間 1～2 字錯位／錯字）
  const auxRatio = Math.max(ratioRequired, 0.75);
  if (substr / minLen >= 0.55 && subseq / minLen >= auxRatio) {
    return true;
  }

  return false;
}

/**
 * 標準化文字：去空格、轉小寫、繁轉簡、日文助詞轉中文（用於比較）
 */
function normalize(text: string): string {
  return convertT2S(
    text
      // NFKC：全形英數→半形（ＳＰＹ→SPY）、全形空白→半形空白、相容字元統一
      .normalize('NFKC')
      .replaceAll(' ', '')
      .toLowerCase()
      // 日文助詞標準化：讓含日文 の 的標題能匹配中文 的
      .replace(/の/g, '的')
      .replace(/は/g, '')
      .replace(/を/g, '')
      .replace(/と/g, '和')
  );
}

function stripSeasonMarkers(text: string): string {
  return text
    .replace(/第[一二三四五六七八九十\d]+(?:季|期|部(?!分)|部分|話|话|集)/g, '')
    .replace(/Season\s*\d+/gi, '')
    .replace(/\bS\d{1,2}\b/gi, '')
    .replace(/\b(?:Part|pt|prat)\s*\d+/gi, '')
    .replace(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)\b/gi, '')
    .replace(/[\s\-_](\d+)(?:$|[\s\-_【（(])/g, '')
    .trim();
}

function cleanComparableTitle(text: string): string {
  return normalize(stripSeasonMarkers(text))
    .replace(/(的故事|動畫版|动画版|真人版|劇場版|剧场版|電影版|电影版)/gi, '')
    .replace(
      /(雙語|双语|國語|国语|日語|日语|中字|字幕|無修|无修|修復|修复|未刪減|未删减|1080p|720p|4k|hevc|x264|x265|aac|uncut|bdrip|webrip|櫻花動漫|樱花动漫|藍光|蓝光|bd)/gi,
      ''
    )
    .replace(/[\s\-_,.:：，。！？【】[\]（）()《》·・‧、～〜~]/g, '')
    .trim();
}

function getSpecialKeywords(text: string): string[] {
  const normalized = normalize(text);
  return SPECIAL_TITLE_KEYWORDS.filter((keyword) =>
    normalized.includes(normalize(keyword))
  );
}

function hasSpecialMismatch(
  query: string,
  vodName: string,
  querySeason: number | null,
  _nameSeason: number | null
): boolean {
  const querySpecials = getSpecialKeywords(query);
  const candidateSpecials = getSpecialKeywords(vodName);

  // 1. 查詢含特定外傳／劇場版關鍵字，結果沒有 → 拒絕
  if (querySpecials.some((k) => !candidateSpecials.includes(k))) {
    return true;
  }

  // 2. 查詢有明確季數，結果卻多出意外特殊關鍵字 → 拒絕
  if (querySeason !== null) {
    if (candidateSpecials.some((k) => !querySpecials.includes(k))) {
      return true;
    }
  }

  return false;
}

/**
 * 比對用的查詢基底：原始輸入 + regional 陸名橋接。
 * 查詢計畫（mainland-search）已用同一張表往 CMS 丟陸名；若比對層不認，
 * 會變成「伺服器搜到了、前端 isFuzzyMatch 濾掉」（鋼彈／蜘蛛人／棋靈王）。
 */
function getMatchQueryBases(query: string): string[] {
  return Array.from(new Set([query, ...getRegionalMainlandTitles(query)]));
}

function hasExactGeneratedVariantMatch(
  vodName: string,
  query: string
): boolean {
  const cName = cleanComparableTitle(vodName);
  const normName = normalize(vodName);

  return getMatchQueryBases(query).some((base) =>
    generateSearchVariants(base).some((variant) => {
      if (!variant || variant === query) return false;
      const cVariant = cleanComparableTitle(variant);
      const normVariant = normalize(variant);

      return (
        (!!cVariant && cName === cVariant) ||
        (!!normVariant && normName === normVariant)
      );
    })
  );
}

function stripNoiseForCompare(text: string): string {
  // 噪音字元含間隔號（·・‧）、波浪號（～〜~）與頓號，這些在
  // CMS 片名與使用者輸入間經常不一致
  return normalize(text).replace(
    /[\s\-_,.:：，。！？【】[\]（）()?….·・‧、～〜~]/g,
    ''
  );
}

/**
 * 包含匹配是否可接受：
 * - 同季時允許較長副標題差
 * - 否則要求長度差 <= 3（避免短詞被超長髒標題吞掉）
 */
function isAcceptableInclusion(
  longerLen: number,
  shorterLen: number,
  sameSeason: boolean
): boolean {
  if (sameSeason) return true;
  return longerLen - shorterLen <= 3;
}

export function getTitleMatchScore(vodName: string, query: string): number {
  if (!vodName || !query || !isFuzzyMatch(vodName, query)) return 0;

  const normName = normalize(vodName);
  const normQuery = normalize(query);
  const cName = cleanComparableTitle(vodName);
  const cQuery = cleanComparableTitle(query);
  const querySeason = extractSeason(query);
  const nameSeason = extractSeason(vodName);

  let score = 100;

  if (normName === normQuery) score += 500;
  if (cName && cQuery && cName === cQuery) score += 350;
  if (normName.includes(normQuery)) score += 160;
  if (normQuery.includes(normName)) score += 120;
  if (cName.includes(cQuery)) score += 120;
  if (cQuery.includes(cName)) score += 80;

  if (querySeason !== null && nameSeason === querySeason) score += 260;
  if (querySeason === null && nameSeason === null) score += 30;

  const queryPart = extractPart(query);
  const namePart = extractPart(vodName);
  if (queryPart !== null && namePart === queryPart) score += 180;

  const candidateSpecials = getSpecialKeywords(vodName);
  const querySpecials = getSpecialKeywords(query);
  const hasUnexpectedSpecial = candidateSpecials.some(
    (keyword) => !querySpecials.includes(keyword)
  );
  if (hasUnexpectedSpecial) score -= querySeason !== null ? 240 : 120;

  // 評分以連續子字串為主，子序列作輕微加權
  const substrLen = getLongestCommonSubstring(cName, cQuery);
  const subseqLen = getLongestCommonSubsequence(cName, cQuery);
  const maxLen = Math.max(cName.length, cQuery.length);
  if (maxLen > 0) {
    score += Math.round((substrLen / maxLen) * 90);
    score += Math.round((subseqLen / maxLen) * 20);
  }

  score -= Math.abs(cName.length - cQuery.length) * 6;

  return Math.max(1, score);
}

export function getBestTitleMatchScore(
  vodName: string,
  queries: Array<string | undefined | null>
): number {
  return queries.reduce((best, query) => {
    if (!query) return best;
    return Math.max(best, getTitleMatchScore(vodName, query));
  }, 0);
}

/**
 * 判斷 vodName 是否與 query 匹配。
 *
 * 匹配規則（優先順序）：
 * 1. 互相包含（精確包含，含長度差護欄）
 * 2. Hybrid LCS：連續子字串為主、子序列為輔
 *    （兩字串長度皆 >= 4 才啟用模糊路徑）
 */
export function isFuzzyMatch(vodName: string, query: string): boolean {
  if (!vodName || !query) return false;

  // 季數感知：兩邊都有季數且不同 → 拒絕
  const querySeason = extractSeason(query);
  const nameSeason = extractSeason(vodName);
  if (
    querySeason !== null &&
    nameSeason !== null &&
    querySeason !== nameSeason
  ) {
    return false;
  }

  // Part 感知：兩邊都有 Part 且不同 → 拒絕
  const queryPart = extractPart(query);
  const namePart = extractPart(vodName);
  if (queryPart !== null && namePart !== null && queryPart !== namePart) {
    return false;
  }

  const sameSeason =
    querySeason !== null && nameSeason !== null && querySeason === nameSeason;

  // 乾淨比較標題（去季數標記、中繼資料、繁簡統一）
  const cQuery = cleanComparableTitle(query);
  const cName = cleanComparableTitle(vodName);
  const normNameCleaned = stripNoiseForCompare(vodName);

  // 1. 查詢有季數、結果無季數
  if (querySeason !== null && nameSeason === null) {
    // 第二季（含）以上、結果完全無季數 → 拒絕
    if (querySeason > 1) {
      return false;
    }
    // 第一季：防誤配外傳／特別篇
    if (hasSpecialMismatch(query, vodName, querySeason, nameSeason)) {
      return false;
    }
  }

  // 2. 結果有季數、查詢無季數（例如查外傳卻命中正片某季）
  if (querySeason === null && nameSeason !== null) {
    if (hasSpecialMismatch(query, vodName, querySeason, nameSeason)) {
      return false;
    }
  }

  // regional 橋接：陸名經人工審定，CMS 常是「陸名／系列前綴＋副標」
  // （例：鋼彈→高达 vs 机动战士高达）。一般長度護欄會擋短陸名，此處放行包含關係。
  const regionalTitles = getRegionalMainlandTitles(query);
  for (const rt of regionalTitles) {
    const normRt = stripNoiseForCompare(rt);
    if (normRt.length >= 2 && normNameCleaned.includes(normRt)) {
      return true;
    }
    const cRt = cleanComparableTitle(rt);
    if (cRt.length >= 2 && cName.includes(cRt)) {
      return true;
    }
  }

  // 3. 兩邊都無季數
  if (querySeason === null && nameSeason === null) {
    if (hasExactGeneratedVariantMatch(vodName, query)) {
      return true;
    }

    if (hasSpecialMismatch(query, vodName, querySeason, nameSeason)) {
      return false;
    }
    // 不互為子字串且未匹配字元過多 → 早期拒絕（以連續子字串計算）
    // 必須連 regional 陸名一起看，否則「棋靈王→棋魂」會在變體迴圈前被誤殺
    const comparableQueries = Array.from(
      new Set([
        cQuery,
        ...regionalTitles
          .map((title) => cleanComparableTitle(title))
          .filter(Boolean),
      ])
    );
    const anyClose = comparableQueries.some((cq) => {
      if (cName.includes(cq) || cq.includes(cName)) return true;
      const substrLen = getLongestCommonSubstring(cName, cq);
      const minLen = Math.min(cName.length, cq.length);
      const maxLen = Math.max(cName.length, cq.length);
      const unmatched =
        maxLen - minLen > 3 ? minLen - substrLen : maxLen - substrLen;
      return unmatched <= 3;
    });
    if (!anyClose) {
      return false;
    }
  }

  // 清理常見干擾後綴（不含季數，季數已在上面處理）
  const cleanSuffixes =
    /(的故事|動畫版|动画版|真人版|劇場版|剧场版|Part\s*\d+|\d+期)/gi;

  // 原始查詢 + regional 陸名都進變體；與 mainland-search 用同一張橋接表
  const variants = new Set<string>();
  for (const base of getMatchQueryBases(query)) {
    generateSearchVariants(base).forEach((v) => variants.add(v));
    if (querySeason === null) {
      const cleanBase = base.replace(cleanSuffixes, '').trim() || base;
      generateSearchVariants(cleanBase).forEach((v) => variants.add(v));
    }
  }

  // 查詢有季數、結果無季數 → 只允許「結果包含查詢」方向，且門檻更高
  const strictDirection = querySeason !== null && nameSeason === null;

  for (const variant of Array.from(variants)) {
    const normQueryCleaned = stripNoiseForCompare(variant);
    if (!normQueryCleaned) continue;

    // 精確包含（繁簡統一後）
    if (strictDirection) {
      if (normNameCleaned.includes(normQueryCleaned)) {
        const unmatched = normNameCleaned.length - normQueryCleaned.length;
        // strict 時不可能同季；僅允許極短尾差
        if (unmatched <= 3) return true;
      }
    } else if (
      normNameCleaned.includes(normQueryCleaned) ||
      normQueryCleaned.includes(normNameCleaned)
    ) {
      const maxLen = Math.max(normNameCleaned.length, normQueryCleaned.length);
      const minLen = Math.min(normNameCleaned.length, normQueryCleaned.length);
      if (isAcceptableInclusion(maxLen, minLen, sameSeason)) {
        return true;
      }
    }

    // Hybrid 模糊比對
    const ratioRequired = strictDirection ? 0.8 : sameSeason ? 0.5 : 0.65;

    if (
      passesHybridCoverage(normNameCleaned, normQueryCleaned, ratioRequired)
    ) {
      return true;
    }
  }

  return false;
}

// 供測試／除錯使用的內部演算法（不改變對外 API 表面）
export const __searchEngineInternals = {
  getLongestCommonSubstring,
  getLongestCommonSubsequence,
  passesHybridCoverage,
  getLCS,
};
