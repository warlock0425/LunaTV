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
