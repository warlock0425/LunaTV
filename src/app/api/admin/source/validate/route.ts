import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import {
  createLinkedAbortController,
  mapWithConcurrency,
} from '@/lib/concurrency';
import { getConfig } from '@/lib/config';
import { validateSourceSite } from '@/lib/source-validation';

export const runtime = 'nodejs';

const SOURCE_VALIDATION_CONCURRENCY = 4;
// 三級檢測含 detail + m3u8 抽樣，較單純搜尋需要更長預算
const SOURCE_VALIDATION_TIMEOUT_MS = 15_000;
/** SSE：1 次點擊 = 1 條連線；留餘裕給管理員重跑，勿壓到個位數 */
const SOURCE_VALIDATE_RATE_LIMIT = 20;
const SOURCE_VALIDATE_RATE_WINDOW_SECONDS = 60;

function sseData(payload: unknown): string {
  return 'data: ' + JSON.stringify(payload) + '\n\n';
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: '權限不足' }, { status: 401 });
  }
  // 限「建立 SSE 連線」次數，不是每個事件
  const limited = await enforceRateLimit(request, {
    namespace: 'api-admin-source-validate',
    limit: SOURCE_VALIDATE_RATE_LIMIT,
    windowSeconds: SOURCE_VALIDATE_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const searchKeyword = searchParams.get('q');

  if (!searchKeyword || !searchKeyword.trim()) {
    return NextResponse.json({ error: '搜尋關鍵詞不能為空' }, { status: 400 });
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig || [];
  let streamClosed = false;
  const validationAbortController = new AbortController();
  const abortValidation = () => {
    streamClosed = true;
    validationAbortController.abort();
  };
  request.signal.addEventListener('abort', abortValidation, { once: true });

  const stream = new ReadableStream({
    async start(streamController) {
      const encoder = new TextEncoder();
      let completedSources = 0;
      let completeSent = false;

      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (streamClosed) return false;
          streamController.enqueue(data);
          return true;
        } catch (error) {
          console.warn('Failed to enqueue data:', error);
          abortValidation();
          return false;
        }
      };

      const sendCompleteIfReady = () => {
        if (
          completeSent ||
          streamClosed ||
          completedSources !== apiSites.length
        ) {
          return;
        }

        completeSent = true;
        if (
          safeEnqueue(
            encoder.encode(
              sseData({
                type: 'complete',
                completedSources,
              })
            )
          )
        ) {
          try {
            streamController.close();
          } catch (error) {
            console.warn('Failed to close controller:', error);
          }
        }
      };

      if (
        !safeEnqueue(
          encoder.encode(
            sseData({
              type: 'start',
              totalSources: apiSites.length,
            })
          )
        )
      ) {
        request.signal.removeEventListener('abort', abortValidation);
        return;
      }

      if (apiSites.length === 0) {
        sendCompleteIfReady();
        request.signal.removeEventListener('abort', abortValidation);
        return;
      }

      await mapWithConcurrency(
        apiSites,
        SOURCE_VALIDATION_CONCURRENCY,
        async (site) => {
          if (validationAbortController.signal.aborted) return;

          const linked = createLinkedAbortController(
            validationAbortController.signal,
            SOURCE_VALIDATION_TIMEOUT_MS
          );

          try {
            const result = await validateSourceSite(site, {
              keyword: searchKeyword.trim(),
              signal: linked.controller.signal,
              probePlayback: true,
            });

            if (!streamClosed) {
              safeEnqueue(
                encoder.encode(
                  sseData({
                    type:
                      result.status === 'invalid'
                        ? 'source_error'
                        : 'source_result',
                    source: result.source,
                    status: result.status,
                    levels: result.levels,
                    message: result.message,
                    resultCount: result.resultCount,
                    episodeCount: result.episodeCount,
                    latencyMs: result.latencyMs,
                  })
                )
              );
            }
          } catch (error) {
            if (!validationAbortController.signal.aborted) {
              console.warn(`Source validation failed for ${site.name}:`, error);
            }
            if (!streamClosed) {
              safeEnqueue(
                encoder.encode(
                  sseData({
                    type: 'source_error',
                    source: site.key,
                    status: 'invalid',
                    levels: {
                      search: 'fail',
                      detail: 'skip',
                      playable: 'skip',
                    },
                    message: '檢測過程發生錯誤',
                    resultCount: 0,
                    episodeCount: 0,
                    latencyMs: 0,
                  })
                )
              );
            }
          } finally {
            linked.cleanup();
            completedSources += 1;
            sendCompleteIfReady();
          }
        }
      );

      request.signal.removeEventListener('abort', abortValidation);
    },
    cancel() {
      abortValidation();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
