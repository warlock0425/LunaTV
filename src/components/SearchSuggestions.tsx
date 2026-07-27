'use client';

import { History, Search, TrendingUp, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
} from '@/lib/db.client';

interface SearchSuggestionsProps {
  query: string;
  isVisible: boolean;
  onSelect: (suggestion: string) => void;
  onClose: () => void;
  onEnterKey: () => void;
}

interface SuggestionItem {
  text: string;
  type: 'related' | 'history' | 'trending';
  icon?: React.ReactNode;
}

const TRENDING_SEARCHES = [
  '進擊的巨人',
  '鬼滅之刃',
  '奧術',
  '咒術迴戰',
  '葬送的芙莉蓮',
  '吉伊卡哇',
  '膽大黨',
];

export default function SearchSuggestions({
  query,
  isVisible,
  onSelect,
  onClose,
  onEnterKey,
}: SearchSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const hist = await getSearchHistory();
      setHistory(hist || []);
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      // 掛載/顯示時抓取歷史：setState 皆在 await 之後，規則保守誤判
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchHistory();
    }
  }, [isVisible, fetchHistory]);

  const fetchSuggestionsFromAPI = useCallback(async (searchQuery: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(
        `/api/search/suggestions?q=${encodeURIComponent(searchQuery)}`,
        { signal: controller.signal }
      );
      if (response.ok) {
        const data = await response.json();
        const apiSuggestions = data.suggestions.map(
          (item: { text: string }) => ({
            text: item.text,
            type: 'related' as const,
          })
        );
        setSuggestions(apiSuggestions);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setSuggestions([]);
      }
    }
  }, []);

  const debouncedFetchSuggestions = useCallback(
    (searchQuery: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      debounceTimer.current = setTimeout(() => {
        if (searchQuery.trim() && isVisible) {
          fetchSuggestionsFromAPI(searchQuery);
        } else {
          setSuggestions([]);
        }
      }, 300);
    },
    [isVisible, fetchSuggestionsFromAPI]
  );

  useEffect(() => {
    if (!isVisible) return;
    debouncedFetchSuggestions(query);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, isVisible, debouncedFetchSuggestions]);

  // 卸載時中止仍在飛的建議請求，否則它會在元件消失後才回來並 setState
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    if (isVisible) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !isVisible) return;

      // 這個監聽器掛在 document 的 capture 階段並且 stopPropagation，
      // 若不限定範圍，只要建議清單還開著就會把「整頁」的 Enter 都吃掉。
      // 滑鼠操作時因為點擊他處會觸發 mousedown 關閉而不易察覺，但純鍵盤
      // 操作沒有 mousedown，清單會一直開著，導致選到別的元素按 Enter 沒反應。
      const target = e.target as Node | null;
      const insideSuggestions = !!(
        target && containerRef.current?.contains(target)
      );
      const isTextInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (!insideSuggestions && !isTextInput) return;

      e.preventDefault();
      e.stopPropagation();
      onClose();
      onEnterKey();
    };
    if (isVisible) document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isVisible, onClose, onEnterKey]);

  // 焦點離開搜尋區時關閉建議清單。原本只靠 mousedown 判定「點到外面」，
  // 純鍵盤操作不會產生 mousedown，清單會一直開著。
  useEffect(() => {
    if (!isVisible) return;
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const showDefaultStates = !query.trim();
  const hasHistory = history.length > 0;

  if (showDefaultStates) {
    return (
      <div
        ref={containerRef}
        className='absolute top-full left-0 right-0 z-[600] mt-2 bg-white/95 dark:bg-surface-panel/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-200/50 dark:border-white/10 max-h-[80vh] overflow-y-auto overflow-x-hidden p-4'
      >
        {hasHistory && (
          <div className='mb-6'>
            <div className='flex items-center justify-between mb-3 px-1'>
              <h3 className='text-sm font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-2 tracking-wide'>
                <History className='w-4 h-4 text-accent' /> 最近搜尋
              </h3>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  await clearSearchHistory();
                  setHistory([]);
                }}
                className='text-[12px] text-zinc-500 hover:text-accent font-medium transition-colors'
              >
                清除全部
              </button>
            </div>
            <div className='flex flex-wrap gap-2'>
              {history.slice(0, 10).map((h) => (
                <div
                  key={`history-${h}`}
                  className='group flex items-center bg-zinc-100 dark:bg-white/5 border border-zinc-200/50 dark:border-white/10 rounded-full overflow-hidden hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors'
                >
                  <button
                    onClick={() => onSelect(h)}
                    className='px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 font-medium truncate max-w-[150px]'
                  >
                    {h}
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await deleteSearchHistory(h);
                      fetchHistory();
                    }}
                    className='pr-3 pl-1 py-2 text-zinc-400 hover:text-accent transition-colors'
                  >
                    <X className='w-3.5 h-3.5' />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className='text-sm font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-2 tracking-wide mb-3 px-1'>
            <TrendingUp className='w-4 h-4 text-accent' /> 大家都在搜
          </h3>
          <div className='flex flex-wrap gap-2'>
            {TRENDING_SEARCHES.map((t) => (
              <button
                key={`trending-${t}`}
                onClick={() => onSelect(t)}
                className='px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 font-medium bg-zinc-100 dark:bg-white/5 border border-zinc-200/50 dark:border-white/10 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-accent dark:hover:text-accent transition-colors'
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className='absolute top-full left-0 right-0 z-[600] mt-2 bg-white/95 dark:bg-surface-panel/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-200/50 dark:border-white/10 max-h-80 overflow-y-auto py-2'
    >
      {suggestions.map((suggestion) => (
        <button
          key={`related-${suggestion.text}`}
          onClick={() => onSelect(suggestion.text)}
          className='w-full px-5 py-3 text-left hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors duration-150 flex items-center gap-4 group'
        >
          <Search className='w-4 h-4 text-zinc-400 group-hover:text-accent transition-colors' />
          <span className='flex-1 text-[15px] font-medium text-zinc-700 dark:text-zinc-200 truncate group-hover:text-accent transition-colors'>
            {suggestion.text}
          </span>
        </button>
      ))}
    </div>
  );
}
