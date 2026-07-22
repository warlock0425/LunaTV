/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { isValidApiSearchQuery } from '@/lib/api-input-validation';
import { cleanQueryForApi } from '@/lib/chinese';
import {
  createLinkedAbortController,
  mapWithConcurrency,
} from '@/lib/concurrency';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { getMainlandSearchQueries } from '@/lib/mainland-search';
import { orderSourcesByHealth, recordSourceSearch } from '@/lib/source-health';
import { orderSourcesByValidation } from '@/lib/source-validation';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};
const SOURCE_SEARCH_CONCURRENCY = 6;

export async function GET(request: NextRequest) {
  const activeUser = await requireActiveUser(request);
  if (!activeUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
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
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          searchAbortController.abort();
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
            console.warn('Failed to close controller:', error);
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
        sendCompleteIfReady();
        return;
      }

      await mapWithConcurrency(
        apiSites,
        SOURCE_SEARCH_CONCURRENCY,
        async (site) => {
          const startedAt = Date.now();
          const linked = createLinkedAbortController(
            searchAbortController.signal,
            6000
          );
          try {
            const results = await searchFromApi(
              site,
              cleanedOriginal,
              searchVariants,
              linked.controller.signal
            );
            recordSourceSearch(
              site.key,
              Date.now() - startedAt,
              linked.controller.signal.aborted &&
                !searchAbortController.signal.aborted
            );

            let filteredResults = results;
            if (!config.SiteConfig.DisableYellowFilter) {
              filteredResults = results.filter((result) => {
                const typeName = result.type_name || '';
                return !yellowWords.some((word: string) =>
                  typeName.includes(word)
                );
              });
            }

            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: site.key,
                sourceName: site.name,
                results: filteredResults,
                timestamp: Date.now(),
              })}\n\n`;

              safeEnqueue(encoder.encode(sourceEvent));
            }

            if (filteredResults.length > 0) {
              allResults.push(...filteredResults);
            }
          } catch (error) {
            console.warn(`搜尋失敗 ${site.name}:`, error);

            if (!streamClosed) {
              const errorEvent = `data: ${JSON.stringify({
                type: 'source_error',
                source: site.key,
                sourceName: site.name,
                error: error instanceof Error ? error.message : '搜尋失敗',
                timestamp: Date.now(),
              })}\n\n`;

              safeEnqueue(encoder.encode(errorEvent));
            }
          } finally {
            linked.cleanup();
            completedSources++;
            sendCompleteIfReady();
          }
        }
      );
      request.signal.removeEventListener('abort', abortFromRequest);
      sendCompleteIfReady();
    },

    cancel() {
      streamClosed = true;
      searchAbortController.abort();
      request.signal.removeEventListener('abort', abortFromRequest);
      console.log('Client disconnected, cancelling search stream');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      ...PRIVATE_NO_STORE_HEADERS,
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
