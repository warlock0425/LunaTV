import { isCjkSearchQuery } from '@/lib/chinese';
import { logger } from '@/lib/logger';
import { readResponseJsonWithLimit } from '@/lib/response-limit';
import { CURRENT_VERSION } from '@/lib/version';

type BangumiInfoboxValue =
  string | number | Array<string | { v?: string; k?: string }>;

export type BangumiSubjectInfo = {
  name?: string;
  name_cn?: string;
  infobox?: Array<{ key?: string; value?: BangumiInfoboxValue }>;
};

const USEFUL_INFOBOX_KEYS = new Set(['中文名', '别名', '別名']);
const BANGUMI_ALIAS_FETCH_TIMEOUT_MS = 5000;
// 單一條目的中繼資料通常只有數 KB；設上限避免異常回應撐爆記憶體。
const MAX_SUBJECT_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * bgm.tv 的 API 規範要求帶可識別的 User-Agent。接到 CURRENT_VERSION 而非寫死，
 * 否則每次發版都會漏改——這裡原本停在 2.0，calendar 那支停在 2.1.9。
 */
export const BANGUMI_USER_AGENT = `LunaTV/${CURRENT_VERSION.replace(
  /^v/,
  ''
)} (+https://github.com/Berserker8888/LunaTV)`;

function collectBangumiInfoValue(value: BangumiInfoboxValue): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === 'string') return [item];
        return [item.v, item.k].filter(Boolean) as string[];
      })
      .filter(Boolean);
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value)];
  }

  return [];
}

export function normalizeAliasList(
  values: Array<string | undefined | null>
): string[] {
  const rawList = Array.from(
    new Set(
      values
        .map((value) => (value || '').trim())
        .filter(
          (value) =>
            value.length >= 2 &&
            value !== 'undefined' &&
            !/^https?:\/\//i.test(value)
        )
    )
  );

  const result: string[] = [];

  for (const val of rawList) {
    // 只留中文別名。英文／日文原文對陸源搜尋用不上。
    if (!isCjkSearchQuery(val)) continue;
    result.push(val);
  }

  return result;
}

export function extractBangumiAliases(data: BangumiSubjectInfo): string[] {
  const aliases: string[] = [data.name_cn, data.name].filter(
    Boolean
  ) as string[];

  (data.infobox || []).forEach((entry) => {
    if (!entry.key || !USEFUL_INFOBOX_KEYS.has(entry.key) || !entry.value) {
      return;
    }
    aliases.push(...collectBangumiInfoValue(entry.value));
  });

  return normalizeAliasList(aliases);
}

export async function fetchBangumiSubjectAliases(
  bangumiId: string
): Promise<string[]> {
  if (!bangumiId) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    BANGUMI_ALIAS_FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `https://api.bgm.tv/v0/subjects/${encodeURIComponent(bangumiId)}`,
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': BANGUMI_USER_AGENT,
        },
      }
    );
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(`Bangumi API returned ${response.status}`);
    }

    const data = await readResponseJsonWithLimit<BangumiSubjectInfo>(
      response,
      MAX_SUBJECT_RESPONSE_BYTES
    );
    return extractBangumiAliases(data);
  } catch (error) {
    logger.warn('取得 Bangumi 別名失敗:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
