/**
 * 上游測速路徑：隱藏 video + hls.js。
 * fetch 播放清單被 CORS 擋住時，改走跟播放器相同的載入方式。
 */
const HLS_PROBE_TIMEOUT_MS = 4000;

function qualityFromWidth(width: number): string {
  if (width >= 3840) return '4K';
  if (width >= 2560) return '2K';
  if (width >= 1920) return '1080p';
  if (width >= 1280) return '720p';
  if (width >= 854) return '480p';
  if (width > 0) return 'SD';
  return '未知';
}

function formatLoadSpeed(bytes: number, durationMs: number): string {
  if (bytes <= 0 || durationMs <= 0) return '未知';
  const kbps = bytes / 1024 / (durationMs / 1000);
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${kbps.toFixed(1)} KB/s`;
}

export async function probeM3u8ByHls(
  m3u8Url: string,
  signal?: AbortSignal
): Promise<{
  quality: string;
  loadSpeed: string;
  pingTime: number;
}> {
  if (typeof document === 'undefined') {
    throw new Error('HLS probe requires a browser');
  }

  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) {
    throw new Error('HLS not supported');
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';

    const hls = new Hls({
      enableWorker: false,
      lowLatencyMode: false,
      maxBufferLength: 6,
      maxBufferSize: 4 * 1000 * 1000,
    });

    let settled = false;
    let pingTime = 0;
    let loadSpeed = '未知';
    let playlistQuality = '未知';
    let hasSpeed = false;
    let hasMetadata = false;
    let fragmentStartTime = 0;

    const pingStart =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    void fetch(m3u8Url, { method: 'HEAD', mode: 'no-cors' })
      .then(() => {
        pingTime = Math.round(
          (typeof performance !== 'undefined'
            ? performance.now()
            : Date.now()) - pingStart
        );
      })
      .catch(() => {
        pingTime = Math.round(
          (typeof performance !== 'undefined'
            ? performance.now()
            : Date.now()) - pingStart
        );
      });

    const cleanup = () => {
      hls.destroy();
      video.remove();
    };

    const finish = (
      error: Error | null,
      value?: { quality: string; loadSpeed: string; pingTime: number }
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      cleanup();
      if (error) reject(error);
      else resolve(value!);
    };

    const onAbort = () => {
      finish(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const timeoutId = setTimeout(() => {
      finish(new Error('Timeout loading video metadata'));
    }, HLS_PROBE_TIMEOUT_MS);

    const tryResolve = () => {
      if (!hasMetadata || !hasSpeed) return;
      const width = video.videoWidth || 0;
      finish(null, {
        quality: width > 0 ? qualityFromWidth(width) : playlistQuality,
        loadSpeed,
        pingTime,
      });
    };

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      const levels = data?.levels || [];
      const maxWidth = levels.reduce(
        (best: number, level: { width?: number }) =>
          Math.max(best, level.width || 0),
        0
      );
      if (maxWidth > 0) playlistQuality = qualityFromWidth(maxWidth);
    });

    hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
      if (hasSpeed) return;
      const stats = data?.frag?.stats;
      const loadTime =
        stats && stats.loading.end > stats.loading.start
          ? stats.loading.end - stats.loading.start
          : fragmentStartTime > 0
            ? (typeof performance !== 'undefined'
                ? performance.now()
                : Date.now()) - fragmentStartTime
            : 0;
      const size = stats?.loaded || data?.payload?.byteLength || 0;
      if (loadTime > 0 && size > 0) {
        loadSpeed = formatLoadSpeed(size, loadTime);
        hasSpeed = true;
        tryResolve();
      }
    });

    hls.on(Hls.Events.FRAG_LOADING, () => {
      fragmentStartTime =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data?.fatal) {
        finish(new Error(`HLS probe failed: ${data.type}`));
      }
    });

    video.onloadedmetadata = () => {
      hasMetadata = true;
      if (!hasSpeed && playlistQuality !== '未知') {
        hasSpeed = true;
        tryResolve();
        return;
      }
      tryResolve();
    };

    video.onerror = () => {
      finish(new Error('Failed to load video metadata'));
    };

    hls.loadSource(m3u8Url);
    hls.attachMedia(video);
  });
}
