'use client';

import { Suspense } from 'react';

import { NetflixHomePage } from '@/components/NetflixHome';
import PageLoading from '@/components/PageLoading';

export default function Home() {
  return (
    <Suspense fallback={<PageLoading />}>
      {/* 首頁原本最高只有 h3（區塊標題），缺少 h1 會讓螢幕閱讀器
          少了一個定位錨點。此標題僅供輔助技術讀取，不影響視覺。 */}
      <h1 className='sr-only'>首頁</h1>
      <NetflixHomePage />
    </Suspense>
  );
}
