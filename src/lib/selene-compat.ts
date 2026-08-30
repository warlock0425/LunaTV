import type { ApiSite } from './config';

/**
 * Selene / Selene-TV（MoonTV v100 客戶端）要的搜尋源列欄位。
 * getAvailableApiSites 只回可用源，disabled 固定 false。
 */
export type SeleneSearchResource = {
  key: string;
  name: string;
  api: string;
  detail: string;
  from: string;
  disabled: boolean;
};

/** Selene LiveSource.fromJson 要的直播源列欄位。 */
export type SeleneLiveSource = {
  key: string;
  name: string;
  url: string;
  ua: string;
  epg: string;
  from: string;
  disabled: boolean;
};

export function toSeleneSearchResource(site: ApiSite): SeleneSearchResource {
  return {
    key: site.key,
    name: site.name,
    api: site.api,
    detail: site.detail || '',
    from: 'config',
    disabled: false,
  };
}

export function toSeleneLiveSource(source: {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  from?: string;
  disabled?: boolean;
}): SeleneLiveSource {
  return {
    key: source.key,
    name: source.name,
    url: source.url,
    ua: source.ua || '',
    epg: source.epg || '',
    from: source.from || 'config',
    disabled: Boolean(source.disabled),
  };
}
