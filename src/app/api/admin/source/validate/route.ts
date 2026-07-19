/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import {
  createLinkedAbortController,
  mapWithConcurrency,
} from '@/lib/concurrency';
import { API_CONFIG, getAdminUser, getConfig } from '@/lib/config';
import { fetchSafeRemoteUrl } from '@/lib/url-safety';

export const runtime = 'nodejs';

const SOURCE_VALIDATION_CONCURRENCY = 6;
const SOURCE_VALIDATION_TIMEOUT_MS = 10_000;

export async function GET(request: NextRequest) {
  const authInfo = await getVerifiedAuthInfo(request);
  const user = await getAdminUser(authInfo?.username);
  if (!user) {
    return NextResponse.json({ error: '權限不足' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const searchKeyword = searchParams.get('q');

  if (!searchKeyword) {
    return NextResponse.json({ error: '搜尋關鍵詞不能為空' }, { status: 400 });
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig;
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
        const completeEvent = `data: ${JSON.stringify({
          type: 'complete',
          completedSources,
        })}\n\n`;

        if (safeEnqueue(encoder.encode(completeEvent))) {
          try {
            streamController.close();
          } catch (error) {
            console.warn('Failed to close controller:', error);
          }
        }
      };

      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        totalSources: apiSites.length,
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
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
            const searchUrl = `${site.api}?ac=videolist&wd=${encodeURIComponent(
              searchKeyword
            )}`;
            const response = await fetchSafeRemoteUrl(searchUrl, {
              headers: API_CONFIG.search.headers,
              signal: linked.controller.signal,
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            // Keep the timeout active until the response body has been read and
            // parsed. A server can send headers immediately and then stall.
            const data = (await response.json()) as any;
            let status: 'valid' | 'no_results';
            if (data && Array.isArray(data.list) && data.list.length > 0) {
              const normalizedKeyword = searchKeyword.toLowerCase();
              const hasMatchingResult = data.list.some((item: any) =>
                String(item?.vod_name || '')
                  .toLowerCase()
                  .includes(normalizedKeyword)
              );
              status = hasMatchingResult ? 'valid' : 'no_results';
            } else {
              status = 'no_results';
            }

            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: site.key,
                status,
              })}\n\n`;
              safeEnqueue(encoder.encode(sourceEvent));
            }
          } catch (error) {
            if (!validationAbortController.signal.aborted) {
              console.warn(`Source validation failed for ${site.name}:`, error);
              const errorEvent = `data: ${JSON.stringify({
                type: 'source_error',
                source: site.key,
                status: 'invalid',
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

      request.signal.removeEventListener('abort', abortValidation);
      sendCompleteIfReady();
    },

    cancel() {
      abortValidation();
      request.signal.removeEventListener('abort', abortValidation);
      console.log('Client disconnected, cancelling validation stream');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
