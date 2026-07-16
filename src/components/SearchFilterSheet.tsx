'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useRef } from 'react';

import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';

import SearchResultFilter, {
  SearchFilterCategory,
  SearchFilterKey,
} from './SearchResultFilter';

interface SearchFilterSheetProps {
  open: boolean;
  activeCount: number;
  categories: SearchFilterCategory[];
  values: Partial<Record<SearchFilterKey, string>>;
  onChange: (values: Record<SearchFilterKey, string>) => void;
  onOpen: () => void;
  onClose: () => void;
}

export default function SearchFilterSheet({
  open,
  activeCount,
  categories,
  values,
  onChange,
  onOpen,
  onClose,
}: SearchFilterSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useAccessibleDialog(open, dialogRef, onClose);

  return (
    <>
      <button
        type='button'
        onClick={onOpen}
        className='inline-flex h-9 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-100 sm:hidden'
        aria-expanded={open}
        aria-controls='mobile-search-filters'
      >
        <SlidersHorizontal className='h-4 w-4' />
        篩選{activeCount > 0 ? ` ${activeCount}` : ''}
      </button>
      {open && (
        <div className='fixed inset-0 z-[1200] sm:hidden'>
          <button
            type='button'
            className='absolute inset-0 bg-black/70 backdrop-blur-sm'
            onClick={onClose}
            aria-label='關閉篩選'
          />
          <section
            ref={dialogRef}
            tabIndex={-1}
            id='mobile-search-filters'
            role='dialog'
            aria-modal='true'
            aria-labelledby='mobile-filter-title'
            className='absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-zinc-700 bg-zinc-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white shadow-2xl'
          >
            <div className='mb-5 flex items-center justify-between'>
              <div>
                <h2 id='mobile-filter-title' className='text-lg font-bold'>
                  篩選搜尋結果
                </h2>
                <p className='mt-1 text-xs text-zinc-400'>
                  依來源、片名與年份縮小結果
                </p>
              </div>
              <button
                type='button'
                onClick={onClose}
                className='flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
                aria-label='關閉篩選'
              >
                <X className='h-5 w-5' />
              </button>
            </div>
            <div className='overflow-x-auto pb-3'>
              <SearchResultFilter
                categories={categories}
                values={values}
                onChange={onChange}
              />
            </div>
            <button
              type='button'
              onClick={onClose}
              className='mt-5 h-12 w-full rounded-xl bg-accent font-bold text-white'
            >
              查看結果
            </button>
          </section>
        </div>
      )}
    </>
  );
}
