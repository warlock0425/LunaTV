'use client';

import { useEffect } from 'react';

import { isChunkLoadError, reloadOnceForStaleChunk } from '@/lib/chunk-reload';

/** 捕捉動態 import / chunk 404，Docker 更新後自動硬重新整理一次。 */
export function ChunkReloadGuard() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
        void reloadOnceForStaleChunk();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) {
        void reloadOnceForStaleChunk();
      }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
