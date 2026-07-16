/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { API_CONFIG, getAdminUser, getConfig } from '@/lib/config';
import { fetchSafeRemoteUrl } from '@/lib/url-safety';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  const user = await getAdminUser(authInfo?.username);
  if (!user) {
    return NextResponse.json({ error: '權限不足' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const searchKeyword = searchParams.get('q');

  if (!searchKeyword) {
    return new Response(JSON.stringify({ error: '搜尋關鍵詞不能為空' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig;

  // 共享狀態
  let streamClosed = false;

  // 創建可讀流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 輔助函數：安全地向控製器寫入資料
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (
            streamClosed ||
            (!controller.desiredSize && controller.desiredSize !== 0)
          ) {
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          return false;
        }
      };

      // 發送開始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        totalSources: apiSites.length,
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return;
      }

      // 記錄已完成的源數量
      let completedSources = 0;

      // 為每個源創建驗證 Promise
      const validationPromises = apiSites.map(async (site) => {
        try {
          // 構建搜尋URL，只獲取第一頁
          const searchUrl = `${site.api}?ac=videolist&wd=${encodeURIComponent(
            searchKeyword
          )}`;

          // 設定超時控製
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          try {
            const response = await fetchSafeRemoteUrl(searchUrl, {
              headers: API_CONFIG.search.headers,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const data = (await response.json()) as any;

            // 檢查結果是否有效
            let status: 'valid' | 'no_results' | 'invalid';
            if (
              data &&
              data.list &&
              Array.isArray(data.list) &&
              data.list.length > 0
            ) {
              // 檢查是否有標題包含搜尋詞的結果
              const validResults = data.list.filter((item: any) => {
                const title = item.vod_name || '';
                return title
                  .toLowerCase()
                  .includes(searchKeyword.toLowerCase());
              });

              if (validResults.length > 0) {
                status = 'valid';
              } else {
                status = 'no_results';
              }
            } else {
              status = 'no_results';
            }

            // 發送該源的驗證結果
            completedSources++;

            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: site.key,
                status,
              })}\n\n`;

              if (!safeEnqueue(encoder.encode(sourceEvent))) {
                streamClosed = true;
                return;
              }
            }
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (error) {
          console.warn(`驗證失敗 ${site.name}:`, error);

          // 發送源錯誤事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              status: 'invalid',
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return;
            }
          }
        }

        // 檢查是否所有源都已完成
        if (completedSources === apiSites.length) {
          if (!streamClosed) {
            // 發送最終完成事件
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              completedSources,
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      // 等待所有驗證完成
      await Promise.allSettled(validationPromises);
    },

    cancel() {
      streamClosed = true;
      console.log('Client disconnected, cancelling validation stream');
    },
  });

  // 返回流式響應
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
