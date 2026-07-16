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

function jaroSimilarity(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 && lenB === 0) return 1;
  if (lenA === 0 || lenB === 0) return 0;
  const matchWindow = Math.floor(Math.max(lenA, lenB) / 2) - 1;
  const matchA = new Array(lenA).fill(false);
  const matchB = new Array(lenB).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < lenA; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, lenB);
    for (let j = start; j < end; j++) {
      if (matchB[j] || a[i] !== b[j]) continue;
      matchA[i] = true;
      matchB[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < lenA; i++) {
    if (!matchA[i]) continue;
    while (!matchB[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / lenA +
      matches / lenB +
      (matches - transpositions / 2) / matches) /
    3;
  const prefixLen = Math.min(4, Math.min(lenA, lenB));
  let prefix = 0;
  for (let i = 0; i < prefixLen; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function titlesMatch(titleA: string, titleB: string): boolean {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  return jaroSimilarity(normA, normB) >= 0.8;
}
