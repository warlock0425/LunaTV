import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { isValidApiSearchQuery } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { cleanQueryForApi } from '@/lib/chinese';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getMainlandSearchQueries } from '@/lib/mainland-search';
import { fanoutSearchSources } from '@/lib/search-fanout';
import { orderSourcesByHealth } from '@/lib/source-health';
import { orderSourcesByValidation } from '@/lib/source-validation';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};
/** SSE 長連線：限「建立連線」次數，不是每個事件 */
const SEARCH_WS_RATE_LIMIT = 45;
const SEARCH_WS_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  const activeUser = await requireActiveUser(request);
  if (!activeUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-search-ws',
    limit: SEARCH_WS_RATE_LIMIT,
    windowSeconds: SEARCH_WS_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const username = activeUser.username;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: '搜尋關鍵詞不能為空' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...PRIVATE_NO_STORE_HEADERS,
      },
    });
  }

  if (!isValidApiSearchQuery(query)) {
    return new Response(JSON.stringify({ error: 'Invalid query parameter' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...PRIVATE_NO_STORE_HEADERS,
      },
    });
  }

  const config = await getConfig();
  let apiSites = orderSourcesByHealth(await getAvailableApiSites(username));
  if (config.SiteConfig.PreferValidatedSourceOrder) {
    apiSites = orderSourcesByValidation(apiSites);
  }
  const searchVariants = getMainlandSearchQueries(query);
  const cleanedOriginal = searchVariants[0] || cleanQueryForApi(query);
  let streamClosed = false;
  const searchAbortController = new AbortController();
  const abortFromRequest = () => searchAbortController.abort();
  request.signal.addEventListener('abort', abortFromRequest, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let completedSources = 0;
      let completeSent = false;
      const allResults: SearchResult[] = [];

      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (streamClosed) return false;
          controller.enqueue(data);
          return true;
        } catch (error) {
          logger.warn('Failed to enqueue data:', error);
          streamClosed = true;
          searchAbortController.abort();
          return false;
        }
      };

      const sendComplete = () => {
        if (completeSent || streamClosed) return;
        completeSent = true;
        const completeEvent = `data: ${JSON.stringify({
          type: 'complete',
          totalResults: allResults.length,
          completedSources,
          timestamp: Date.now(),
        })}\n\n`;

        if (safeEnqueue(encoder.encode(completeEvent))) {
          try {
            controller.close();
          } catch (error) {
            logger.warn('Failed to close controller:', error);
          }
        }
      };

      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        query,
        primaryQuery: cleanedOriginal,
        queryVariantCount: searchVariants.length,
        totalSources: apiSites.length,
        timestamp: Date.now(),
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return;
      }

      if (apiSites.length === 0) {
        sendComplete();
        return;
      }

      await fanoutSearchSources({
        sites: apiSites,
        query: cleanedOriginal,
        variants: searchVariants,
        parentSignal: searchAbortController.signal,
        onSiteResult: (entry) => {
          if (entry.skipped) return;
          completedSources++;

          if (entry.error) {
            logger.warn(`搜尋失敗 ${entry.site.name}:`, entry.error);
            if (!streamClosed) {
              const errorEvent = `data: ${JSON.stringify({
                type: 'source_error',
                source: entry.site.key,
                sourceName: entry.site.name,
                error:
                  entry.error instanceof Error
                    ? entry.error.message
                    : '搜尋失敗',
                timestamp: Date.now(),
              })}\n\n`;
              safeEnqueue(encoder.encode(errorEvent));
            }
            return;
          }

          let filteredResults = entry.results;
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = entry.results.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) =>
                typeName.includes(word)
              );
            });
          }

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: entry.site.key,
              sourceName: entry.site.name,
              results: filteredResults,
              timestamp: Date.now(),
            })}\n\n`;
            safeEnqueue(encoder.encode(sourceEvent));
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }
        },
      });

      request.signal.removeEventListener('abort', abortFromRequest);
      sendComplete();
    },

    cancel() {
      streamClosed = true;
      searchAbortController.abort();
      request.signal.removeEventListener('abort', abortFromRequest);
      logger.debug('Client disconnected, cancelling search stream');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      ...PRIVATE_NO_STORE_HEADERS,
      Connection: 'keep-alive',
    },
  });
}
