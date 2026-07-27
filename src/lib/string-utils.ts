import { convertS2T } from './s2t';

const COMMON_SUFFIXES = [
  '動畫版',
  '電影版',
  '真人版',
  '第一季',
  '第二季',
  '第三季',
  '第四季',
  '第五季',
  '第六季',
  '第七季',
  '第八季',
  '第九季',
  '第十季',
  'Season 1',
  'Season 2',
  'Season 3',
  'Part 1',
  'Part 2',
  'Part 3',
  '第1季',
  '第2季',
  '第3季',
  '上部',
  '下部',
  '終章',
  '前傳',
  '後傳',
  '劇場版',
  'OVA',
  'OAD',
  '國語',
  '英語',
  '日語',
  '粵語',
  '完整版',
  '加長版',
  '導演剪輯版',
];

function stripSuffix(title: string): string {
  let result = title;
  for (const suffix of COMMON_SUFFIXES) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
      break;
    }
  }
  return result;
}

export function normalizeTitle(title: string): string {
  return stripSuffix(convertS2T(title))
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function normalizePlayRecordTitle(title?: string): string {
  return convertS2T(title || '')
    .replace(/[\s\-_,.:：，。!！?？]/g, '')
    .trim();
}

export function cleanSourceName(source?: string): string {
  return (source || '').replace(/(資源|片源)/g, '').trim();
}

/**
 * 影片標題斷詞：僅以空白、連字號、冒號（半形／全形）、間隔號、頓號切分。
 *
 * 連字號必須放在字元類結尾才是字面意義。曾經寫成 `[ -:：·、-]`，其中 ` -:`
 * 被當成 0x20–0x3A 的範圍，涵蓋所有數字與大部分 ASCII 標點，
 * 「進擊的巨人第2季」會被切成「進擊的巨人第」「季」，季數與年份全被吃掉。
 */
const TITLE_WORD_SEPARATORS = /[ :：·、-]/;

export function splitTitleWords(text: string): string[] {
  return text.split(TITLE_WORD_SEPARATORS);
}
