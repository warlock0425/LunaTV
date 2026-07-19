import { logger } from '@/lib/logger';

type BangumiInfoboxValue =
  string | number | Array<string | { v?: string; k?: string }>;

export type BangumiSubjectInfo = {
  name?: string;
  name_cn?: string;
  infobox?: Array<{ key?: string; value?: BangumiInfoboxValue }>;
};

const USEFUL_INFOBOX_KEYS = new Set(['中文名', '别名', '別名']);
const BANGUMI_ALIAS_FETCH_TIMEOUT_MS = 5000;

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
  let hasEnglishBackup = false;

  for (const val of rawList) {
    // 1. 過濾包含日文假名（平假名/片假名）的別名，避免中文採集站誤配
    if (/[\u3040-\u30ff]/.test(val)) {
      continue;
    }

    // 2. 若為純英文別名（可能為備援）
    const isPureEnglish = /^[a-zA-Z0-9\s\-:’'’]+$/.test(val);
    if (isPureEnglish) {
      // 只保留第一個英文別名作為備援，避免別名過雜
      if (!hasEnglishBackup) {
        result.push(val);
        hasEnglishBackup = true;
      }
    } else {
      // 3. 中文名稱或中文別名（含漢字）予以保留
      result.push(val);
    }
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
          'User-Agent':
            'BerserkerTV/2.0 (+https://github.com/Berserker8888/LunaTV)',
        },
      }
    );
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(`Bangumi API returned ${response.status}`);
    }

    const data = (await response.json()) as BangumiSubjectInfo;
    return extractBangumiAliases(data);
  } catch (error) {
    logger.warn('取得 Bangumi 別名失敗:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
