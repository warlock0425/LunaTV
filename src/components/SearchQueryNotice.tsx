import { Languages } from 'lucide-react';
import { useMemo } from 'react';

import { getTriedMainlandLabel } from '@/lib/search-tried-mainland';

export default function SearchQueryNotice({
  query,
  resolvedQuery,
}: {
  query: string;
  resolvedQuery?: string;
}) {
  const target = useMemo(
    () => getTriedMainlandLabel(query, resolvedQuery),
    [query, resolvedQuery]
  );

  if (!target) return null;

  return (
    <div className='mx-auto mt-3 flex max-w-2xl items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300'>
      <Languages className='mt-0.5 h-4 w-4 shrink-0 text-accent' />
      <p>
        已自動使用中國片名
        <span className='mx-1 font-semibold text-zinc-900 dark:text-white'>
          {target}
        </span>
        搜尋，畫面仍保留原始輸入。
      </p>
    </div>
  );
}
