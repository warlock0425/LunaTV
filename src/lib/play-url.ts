interface PlayUrlOptions {
  source?: string | null;
  id?: string | null;
  title?: string | null;
  year?: string | number | null;
  stype?: string | null;
  stitle?: string | null;
  prefer?: boolean;
  bgmId?: string | number | null;
  episode?: string | number | null;
  url?: string | null;
}

function setParam(
  params: URLSearchParams,
  key: string,
  value?: string | number | null
) {
  if (value === undefined || value === null || value === '') return;
  params.set(key, String(value));
}

export function buildPlayUrl(options: PlayUrlOptions): string {
  const params = new URLSearchParams();

  setParam(params, 'source', options.source);
  setParam(params, 'id', options.id);
  setParam(params, 'title', options.title?.trim());
  setParam(params, 'year', options.year);
  setParam(params, 'stype', options.stype);
  setParam(params, 'stitle', options.stitle?.trim());
  setParam(params, 'bgm_id', options.bgmId);
  setParam(params, 'episode', options.episode);
  setParam(params, 'url', options.url);
  if (options.prefer) params.set('prefer', 'true');

  return `/play?${params.toString()}`;
}
