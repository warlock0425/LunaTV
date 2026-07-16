/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { Suspense } from 'react';

import { NetflixHomePage } from '@/components/NetflixHome';
import PageLoading from '@/components/PageLoading';

export default function Home() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NetflixHomePage />
    </Suspense>
  );
}
