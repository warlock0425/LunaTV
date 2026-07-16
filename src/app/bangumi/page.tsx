'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function BangumiPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/douban?type=anime');
  }, [router]);
  return null;
}
