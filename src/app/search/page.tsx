/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any,no-empty */
'use client';

import { ChevronUp, LayoutGrid, List, Play, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, {
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cleanQueryForApi } from '@/lib/chinese';
import { addSearchHistory } from '@/lib/db.client';
import { getResultEpisodeCount } from '@/lib/play-page-utils';
import { buildPlayUrl } from '@/lib/play-url';
import { getTriedMainlandLabel } from '@/lib/search-tried-mainland';
import { isFuzzyMatch } from '@/lib/searchEngine';
import { readStreamingSearchPreference } from '@/lib/streaming-search-preference';
import { SearchResult } from '@/lib/types';
import { getProxiedImageUrl, processImageUrl } from '@/lib/utils';
import { useClientValue } from '@/hooks/useClientMount';

import PageLayout from '@/components/PageLayout';
import PageLoading from '@/components/PageLoading';
import SearchFilterSheet from '@/components/SearchFilterSheet';
import SearchQueryNotice from '@/components/SearchQueryNotice';
import SearchResultFilter, {
  SearchFilterCategory,
} from '@/components/SearchResultFilter';
import SearchSuggestions from '@/components/SearchSuggestions';
import VideoCard, { VideoCardHandle } from '@/components/VideoCard';
import VirtualGrid from '@/components/VirtualGrid';

import { sortSearchItems } from './search-sort';

function SearchPageClient() {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const showBackToTopRef = useRef(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQueryRef = useRef<string>('');
  // searchQuery 是輸入框的即時值，會隨每次按鍵變動；
  // submittedQuery 才是這批結果對應的查詢詞。結果的過濾與排序一律用後者，
  // 否則使用者一開始輸入下一個關鍵字，畫面上的舊結果就會被逐字元濾光。
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [resolvedSearchQuery, setResolvedSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const pendingResultsRef = useRef<SearchResult[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  // 本輪搜尋累計收到的結果數（用於判斷是否需要豆瓣別名重搜）
  const receivedCountRef = useRef(0);
  // 已嘗試過別名重搜的查詢，避免重搜結果為空時無限迴圈
  const aliasRetriedRef = useRef<string | null>(null);
  // 流式搜尋偏好：初始值由瀏覽器端讀取，之後每次搜尋重讀時可覆寫
  const initialFluidSearch = useClientValue(() => {
    const defaultFluidSearch = window.RUNTIME_CONFIG?.FLUID_SEARCH !== false;
    return readStreamingSearchPreference(localStorage, defaultFluidSearch);
  }, true);
  const [fluidOverride, setFluidOverride] = useState<boolean | null>(null);
  const useFluidSearch = fluidOverride ?? initialFluidSearch;
  const initialLayoutMode = useClientValue(() => {
    try {
      const saved = localStorage.getItem('search_layout_mode');
      return saved === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  }, 'grid');
  const [layoutOverride, setLayoutOverride] = useState<'grid' | 'list' | null>(
    null
  );
  const layoutMode = layoutOverride ?? initialLayoutMode;
  // 播放連結與卡片 query 必須用已送出的關鍵字，不能跟輸入框即時值綁在一起。
  const resultQuery = submittedQuery.trim();
  const groupRefs = useRef<
    Map<string, React.RefObject<VideoCardHandle | null>>
  >(new Map());
  const groupStatsRef = useRef<
    Map<
      string,
      { douban_id?: number; episodes?: number; source_names: string[] }
    >
  >(new Map());

  const handleLayoutModeChange = (mode: 'grid' | 'list') => {
    setLayoutOverride(mode);
    try {
      localStorage.setItem('search_layout_mode', mode);
    } catch {
      // ignore
    }
  };

  // 記錄與還原滾動位置（依目前搜尋關鍵字分開記，避免不同搜尋互相跳轉高度）
  useEffect(() => {
    const queryKey = submittedQuery.trim();
    if (!queryKey) return;
    const storageKey = `luna_search_scroll_${encodeURIComponent(queryKey)}`;
    const handleScroll = () => {
      try {
        sessionStorage.setItem(storageKey, String(window.scrollY));
      } catch {
        // ignore
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [submittedQuery]);

  useEffect(() => {
    const queryKey = submittedQuery.trim();
    if (!isLoading && searchResults.length > 0 && queryKey) {
      try {
        const storageKey = `luna_search_scroll_${encodeURIComponent(queryKey)}`;
        const savedScroll = sessionStorage.getItem(storageKey);
        if (savedScroll && Number(savedScroll) > 0) {
          window.scrollTo({ top: Number(savedScroll), behavior: 'instant' });
        }
      } catch {
        // ignore
      }
    }
  }, [isLoading, searchResults.length, submittedQuery]);

  /**
   * 台灣片名在大陸片源站常有完全不同的譯名（魔戒→指环王），
   * 字元轉換與內建別名表都涵蓋不到。搜尋完全沒有結果時，
   * 改用豆瓣反查大陸片名再搜一輪；失敗則靜默維持原本的空結果。
   */
  const retryWithDoubanAlias = async (originalQuery: string) => {
    if (aliasRetriedRef.current === originalQuery) return;
    aliasRetriedRef.current = originalQuery;

    try {
      const proxyType =
        localStorage.getItem('doubanDataSource') || 'cmliussss-cdn-tencent';
      const aliasResponse = await fetch(
        `/api/douban/alias?q=${encodeURIComponent(
          originalQuery
        )}&proxyType=${encodeURIComponent(proxyType)}`
      );
      if (!aliasResponse.ok) return;
      const { primary } = (await aliasResponse.json()) as {
        primary?: string | null;
      };
      if (!primary) return;
      // 期間使用者可能已改搜別的關鍵字
      if (currentQueryRef.current !== originalQuery) return;

      setIsLoading(true);
      const searchResponse = await fetch(
        `/api/search?q=${encodeURIComponent(primary)}`
      );
      const data = await searchResponse.json();
      if (currentQueryRef.current !== originalQuery) return;

      // 即使重搜仍無結果，也寫入 resolved：空狀態／SearchQueryNotice 會秀陸名與「再搜」鈕；
      // 否則會退回字元轉換版（例如「星际大战」而非豆瓣「星球大战」）
      setResolvedSearchQuery(primary);

      if (Array.isArray(data.results) && data.results.length > 0) {
        const activeYearOrder =
          viewModeRef.current === 'agg'
            ? filterAggRef.current.yearOrder
            : filterAllRef.current.yearOrder;
        const results: SearchResult[] =
          activeYearOrder === 'none'
            ? sortBatchForNoOrder(data.results as SearchResult[])
            : (data.results as SearchResult[]);
        receivedCountRef.current += results.length;
        setSearchResults(results);
        setTotalSources(1);
        setCompletedSources(1);
      }
    } catch {
      // 豆瓣不可用時維持原本的空結果
    } finally {
      if (currentQueryRef.current === originalQuery) {
        setIsLoading(false);
      }
    }
  };

  const getGroupRef = (key: string) => {
    let ref = groupRefs.current.get(key);
    if (!ref) {
      ref = React.createRef<VideoCardHandle>();
      groupRefs.current.set(key, ref);
    }
    return ref;
  };

  const computeGroupStats = (group: SearchResult[]) => {
    const episodes = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        const len = getResultEpisodeCount(g);
        if (len > 0) countMap.set(len, (countMap.get(len) || 0) + 1);
      });
      let max = 0;
      let res = 0;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();
    const source_names = Array.from(
      new Set(group.map((g) => g.source_name).filter(Boolean))
    ) as string[];

    const douban_id = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        if (g.douban_id && g.douban_id > 0) {
          countMap.set(g.douban_id, (countMap.get(g.douban_id) || 0) + 1);
        }
      });
      let max = 0;
      let res: number | undefined;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();

    const type_name = (() => {
      const countMap = new Map<string, number>();
      group.forEach((g) => {
        if (g.type_name) {
          countMap.set(g.type_name, (countMap.get(g.type_name) || 0) + 1);
        }
      });
      let max = 0;
      let res: string | undefined;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();

    return { episodes, source_names, douban_id, type_name };
  };

  const [filterAll, setFilterAll] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });
  const filterAllRef = useRef(filterAll);

  const [filterAgg, setFilterAgg] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });
  const filterAggRef = useRef(filterAgg);

  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting =
        localStorage.getItem('defaultAggregateSearch') ??
        localStorage.getItem('defaultAggregateResults');
      if (userSetting !== null) {
        try {
          return JSON.parse(userSetting);
        } catch {
          return true;
        }
      }
    }
    return true;
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  const activeFilterCount = useMemo(() => {
    const values = viewMode === 'agg' ? filterAgg : filterAll;
    return (
      [values.source, values.title, values.year].filter(
        (value) => value !== 'all'
      ).length + (values.yearOrder === 'none' ? 0 : 1)
    );
  }, [filterAgg, filterAll, viewMode]);
  const viewModeRef = useRef(viewMode);

  useEffect(() => {
    filterAllRef.current = filterAll;
    filterAggRef.current = filterAgg;
    viewModeRef.current = viewMode;
  }, [filterAll, filterAgg, viewMode]);

  const sortBatchForNoOrder = (items: SearchResult[]) => {
    const q = currentQueryRef.current.trim();
    return items.slice().sort((a, b) => {
      const aExact = (a.title || '').trim() === q;
      const bExact = (b.title || '').trim() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aNum = Number.parseInt(a.year, 10);
      const bNum = Number.parseInt(b.year, 10);
      const aValid = !Number.isNaN(aNum);
      const bValid = !Number.isNaN(bNum);
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (aValid && bValid) return bNum - aNum;
      return 0;
    });
  };

  // 核心更新：對 API 返回的結果進行模糊匹配過濾，根治譯名差異導致的空畫面
  const fuzzySearchResults = useMemo(() => {
    const query = submittedQuery.trim();
    if (!query) return searchResults;
    return searchResults.filter((item) => isFuzzyMatch(item.title, query));
  }, [searchResults, submittedQuery]);

  // 空結果要秀的「實際試過的中國片名」；與 SearchQueryNotice 同一套優先序
  const triedMainlandLabel = useMemo(
    () => getTriedMainlandLabel(submittedQuery, resolvedSearchQuery),
    [submittedQuery, resolvedSearchQuery]
  );

  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    const keyOrder: string[] = [];

    fuzzySearchResults.forEach((item) => {
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      if (arr.length === 0) keyOrder.push(key);
      arr.push(item);
      map.set(key, arr);
    });

    return keyOrder.map(
      (key) => [key, map.get(key)!] as [string, SearchResult[]]
    );
  }, [fuzzySearchResults]);

  useEffect(() => {
    aggregatedResults.forEach(([mapKey, group]) => {
      const stats = computeGroupStats(group);
      const prev = groupStatsRef.current.get(mapKey);
      if (!prev) {
        groupStatsRef.current.set(mapKey, stats);
        return;
      }
      const ref = groupRefs.current.get(mapKey);
      if (ref && ref.current) {
        if (prev.episodes !== stats.episodes) {
          ref.current.setEpisodes(stats.episodes);
        }
        const prevNames = (prev.source_names || []).join('|');
        const nextNames = (stats.source_names || []).join('|');
        if (prevNames !== nextNames) {
          ref.current.setSourceNames(stats.source_names);
        }
        if (prev.douban_id !== stats.douban_id) {
          ref.current.setDoubanId(stats.douban_id);
        }
        groupStatsRef.current.set(mapKey, stats);
      }
    });
  }, [aggregatedResults]);

  const filterOptions = useMemo(() => {
    const sourcesSet = new Map<string, string>();
    const titlesSet = new Set<string>();
    const yearsSet = new Set<string>();

    fuzzySearchResults.forEach((item) => {
      if (item.source && item.source_name) {
        sourcesSet.set(item.source, item.source_name);
      }
      if (item.title) titlesSet.add(item.title);
      if (item.year) yearsSet.add(item.year);
    });

    const sourceOptions: { label: string; value: string }[] = [
      { label: '全部來源', value: 'all' },
      ...Array.from(sourcesSet.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ label, value })),
    ];

    const titleOptions: { label: string; value: string }[] = [
      { label: '全部標題', value: 'all' },
      ...Array.from(titlesSet.values())
        .sort((a, b) => a.localeCompare(b))
        .map((t) => ({ label: t, value: t })),
    ];

    const years = Array.from(yearsSet.values());
    const knownYears = years
      .filter((y) => y !== 'unknown')
      .sort((a, b) => parseInt(b) - parseInt(a));
    const hasUnknown = years.includes('unknown');
    const yearOptions: { label: string; value: string }[] = [
      { label: '全部年份', value: 'all' },
      ...knownYears.map((y) => ({ label: y, value: y })),
      ...(hasUnknown ? [{ label: '未知', value: 'unknown' }] : []),
    ];

    const categoriesAll: SearchFilterCategory[] = [
      { key: 'source', label: '來源', options: sourceOptions },
      { key: 'title', label: '標題', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    const categoriesAgg: SearchFilterCategory[] = [
      { key: 'source', label: '來源', options: sourceOptions },
      { key: 'title', label: '標題', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    return { categoriesAll, categoriesAgg };
  }, [fuzzySearchResults]);

  const filteredAllResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAll;
    const filtered = fuzzySearchResults.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (title !== 'all' && item.title !== title) return false;
      if (year !== 'all' && item.year !== year) return false;
      return true;
    });

    // 預設 yearOrder === 'none' 也必須跑相關性排序（只跳過年份鍵）
    return sortSearchItems(filtered, submittedQuery, yearOrder);
  }, [fuzzySearchResults, filterAll, submittedQuery]);

  const filteredAggResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAgg;
    const filtered = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource =
        source === 'all' ? true : group.some((item) => item.source === source);
      if (!hasSource) return false;
      if (title !== 'all' && gTitle !== title) return false;
      if (year !== 'all' && gYear !== year) return false;
      return true;
    });

    // 聚合列以群組代表作標題／年份排序（預設路徑同樣走相關性）
    const representatives = filtered.map(([key, group]) => ({
      key,
      group,
      title: group[0]?.title ?? '',
      year: group[0]?.year ?? 'unknown',
    }));
    const sorted = sortSearchItems(representatives, submittedQuery, yearOrder);
    return sorted.map(
      (entry) => [entry.key, entry.group] as [string, SearchResult[]]
    );
  }, [aggregatedResults, filterAgg, submittedQuery]);

  useEffect(() => {
    if (!searchParams.get('q')) {
      document.getElementById('searchInput')?.focus();
    }

    const handleScroll = () => {
      const shouldShow = (document.body.scrollTop || 0) > 300;
      if (showBackToTopRef.current !== shouldShow) {
        showBackToTopRef.current = shouldShow;
        setShowBackToTop(shouldShow);
      }
    };

    handleScroll();
    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // URL 查詢參數變化驅動的搜尋協調：同步重置載入狀態並啟動
  // EventSource/fetch，屬 URL→狀態同步的協調器，同步 setState 為刻意設計
  useEffect(() => {
    const query = searchParams.get('q') || '';
    currentQueryRef.current = query.trim();

    if (query) {
      addSearchHistory(query);
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      // URL→狀態協調器：q 參數變動時需同步重置整組搜尋狀態後才能啟動串流，
      // 屬本檔頂部註解所述的刻意設計。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchQuery(query);
      setSubmittedQuery(query);
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }
      // 這兩張表以「標題-年份-類型」為鍵，跨搜尋不會重用，不清會一直長
      groupRefs.current.clear();
      groupStatsRef.current.clear();
      setSearchResults([]);
      setResolvedSearchQuery('');
      setTotalSources(0);
      setCompletedSources(0);
      receivedCountRef.current = 0;
      pendingResultsRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setIsLoading(true);
      setShowResults(true);

      const trimmed = query.trim();
      let currentFluidSearch = useFluidSearch;
      if (typeof window !== 'undefined') {
        const defaultFluidSearch =
          window.RUNTIME_CONFIG?.FLUID_SEARCH !== false;
        currentFluidSearch = readStreamingSearchPreference(
          localStorage,
          defaultFluidSearch
        );
      }

      if (currentFluidSearch !== useFluidSearch) {
        setFluidOverride(currentFluidSearch);
      }

      if (currentFluidSearch) {
        // 核心修正：在發起請求前，將查詢詞極簡化以提昇採集站命中率
        const cleanedQuery = cleanQueryForApi(trimmed);
        const es = new EventSource(
          `/api/search/ws?q=${encodeURIComponent(cleanedQuery)}`
        );
        eventSourceRef.current = es;

        let closed = false;
        es.onmessage = (event) => {
          if (
            closed ||
            eventSourceRef.current !== es ||
            currentQueryRef.current !== trimmed
          )
            return;
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data);
            if (currentQueryRef.current !== trimmed) return;
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                setResolvedSearchQuery(payload.primaryQuery || '');
                break;
              case 'source_result': {
                setCompletedSources((prev) => prev + 1);
                if (
                  Array.isArray(payload.results) &&
                  payload.results.length > 0
                ) {
                  const activeYearOrder =
                    viewModeRef.current === 'agg'
                      ? filterAggRef.current.yearOrder
                      : filterAllRef.current.yearOrder;
                  const incoming: SearchResult[] =
                    activeYearOrder === 'none'
                      ? sortBatchForNoOrder(payload.results as SearchResult[])
                      : (payload.results as SearchResult[]);
                  receivedCountRef.current += incoming.length;
                  pendingResultsRef.current.push(...incoming);
                  if (!flushTimerRef.current) {
                    const timerId = window.setTimeout(() => {
                      if (
                        flushTimerRef.current !== timerId ||
                        closed ||
                        eventSourceRef.current !== es ||
                        currentQueryRef.current !== trimmed
                      ) {
                        return;
                      }
                      const toAppend = pendingResultsRef.current;
                      pendingResultsRef.current = [];
                      startTransition(() => {
                        setSearchResults((prev) => prev.concat(toAppend));
                      });
                      flushTimerRef.current = null;
                    }, 80);
                    flushTimerRef.current = timerId;
                  }
                }
                break;
              }
              case 'source_error':
                setCompletedSources((prev) => prev + 1);
                break;
              case 'complete':
                closed = true;
                setCompletedSources(payload.completedSources || totalSources);
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setSearchResults((prev) => prev.concat(toAppend));
                  });
                }
                setIsLoading(false);
                try {
                  es.close();
                } catch {}
                if (eventSourceRef.current === es) {
                  eventSourceRef.current = null;
                }
                if (receivedCountRef.current === 0) {
                  void retryWithDoubanAlias(trimmed);
                }
                break;
            }
          } catch {}
        };

        es.onerror = () => {
          if (
            closed ||
            eventSourceRef.current !== es ||
            currentQueryRef.current !== trimmed
          )
            return;
          closed = true;
          setIsLoading(false);
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setSearchResults((prev) => prev.concat(toAppend));
            });
          }
          try {
            es.close();
          } catch {}
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
        };
      } else {
        const trimmedQuery = query.trim();
        const cleanedQuery = cleanQueryForApi(trimmedQuery);
        const controller = new AbortController();
        searchAbortRef.current = controller;
        fetch(`/api/search?q=${encodeURIComponent(cleanedQuery)}`, {
          signal: controller.signal,
        })
          .then((response) => response.json())
          .then((data) => {
            if (currentQueryRef.current !== trimmedQuery) return;

            if (data.results && Array.isArray(data.results)) {
              setResolvedSearchQuery(data.primaryQuery || '');
              const activeYearOrder =
                viewModeRef.current === 'agg'
                  ? filterAggRef.current.yearOrder
                  : filterAllRef.current.yearOrder;
              const results: SearchResult[] =
                activeYearOrder === 'none'
                  ? sortBatchForNoOrder(data.results as SearchResult[])
                  : (data.results as SearchResult[]);

              receivedCountRef.current += results.length;
              setSearchResults(results);
              setTotalSources(1);
              setCompletedSources(1);
            }
            setIsLoading(false);
            if (receivedCountRef.current === 0) {
              void retryWithDoubanAlias(trimmedQuery);
            }
          })
          .catch(() => {
            if (
              !controller.signal.aborted &&
              searchAbortRef.current === controller &&
              currentQueryRef.current === trimmedQuery
            ) {
              setIsLoading(false);
            }
          })
          .finally(() => {
            if (searchAbortRef.current === controller) {
              searchAbortRef.current = null;
            }
          });
      }
      setShowSuggestions(false);
    } else {
      setSubmittedQuery('');
      setShowResults(false);
      setShowSuggestions(false);
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      const es = eventSourceRef.current;
      if (es) {
        try {
          es.close();
        } catch {}
        eventSourceRef.current = null;
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      pendingResultsRef.current = [];
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (value.trim()) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleInputFocus = () => {
    if (searchQuery.trim()) {
      setShowSuggestions(true);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);
    setShowSuggestions(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    setIsLoading(true);
    setShowResults(true);
    router.push(`/search?q=${encodeURIComponent(suggestion)}`);
  };

  /** 空結果「用陸名再搜」：把實際採用的中國片名寫進 URL，走同一套搜尋協調器 */
  const handleRetryWithMainland = (mainlandTitle: string) => {
    const trimmed = mainlandTitle.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);
    setShowSuggestions(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const scrollToTop = () => {
    try {
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      document.body.scrollTop = 0;
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder='搜尋電影、電視劇...'
                autoComplete='off'
                className='w-full h-12 rounded-lg bg-zinc-50/80 py-3 pl-10 pr-12 text-sm text-zinc-700 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white border border-zinc-200/50 shadow-sm dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500 dark:focus:bg-zinc-700 dark:border-zinc-700'
              />
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    setShowSuggestions(false);
                    document.getElementById('searchInput')?.focus();
                  }}
                  // 原本可點區域只有 20x20，對觸控過小；放大到 40x40 並讓
                  // 圖示維持原尺寸置中，外觀不變
                  className='absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
                  aria-label='清除搜尋內容'
                >
                  <X className='h-5 w-5' />
                </button>
              )}
              <SearchSuggestions
                query={searchQuery}
                isVisible={showSuggestions}
                onSelect={handleSuggestionSelect}
                onClose={() => setShowSuggestions(false)}
                onEnterKey={() => {
                  const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
                  if (!trimmed) return;
                  setSearchQuery(trimmed);
                  setIsLoading(true);
                  setShowResults(true);
                  setShowSuggestions(false);
                  router.push(`/search?q=${encodeURIComponent(trimmed)}`);
                }}
              />
            </div>
          </form>
          {showResults && (
            <SearchQueryNotice
              query={submittedQuery}
              resolvedQuery={resolvedSearchQuery}
            />
          )}
        </div>
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {showResults ? (
            <section className='mb-12'>
              <div className='mb-4 space-y-2'>
                <h1 className='text-xl font-bold text-zinc-800 dark:text-zinc-200 flex flex-wrap items-center gap-2'>
                  <span>搜尋結果</span>
                  {totalSources > 0 && useFluidSearch && (
                    <span className='text-sm font-normal text-zinc-500 dark:text-zinc-400 tabular-nums'>
                      片源 {completedSources}/{totalSources}
                      {isLoading ? ' 搜尋中…' : ' 完成'}
                    </span>
                  )}
                  {isLoading && useFluidSearch && (
                    <span className='inline-block h-3.5 w-3.5 border-2 border-zinc-300 border-t-accent rounded-full animate-spin' />
                  )}
                </h1>
                {totalSources > 0 && useFluidSearch && (
                  <div
                    className='h-1 w-full max-w-md rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden'
                    role='progressbar'
                    aria-valuenow={completedSources}
                    aria-valuemin={0}
                    aria-valuemax={totalSources}
                    aria-label='搜尋片源進度'
                  >
                    <div
                      className='h-full bg-accent transition-all duration-300 ease-out'
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (completedSources / Math.max(totalSources, 1)) * 100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              {/* 篩選列固定顯示：串流搜尋的結果逐批到達，若依結果數顯示會在
                  搜尋途中突然插入而推擠版面 */}
              <div className='mb-8 flex items-center justify-between gap-3'>
                <div className='hidden flex-1 min-w-0 sm:block'>
                  {viewMode === 'agg' ? (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAgg}
                      values={filterAgg}
                      onChange={(v) => setFilterAgg(v as any)}
                    />
                  ) : (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAll}
                      values={filterAll}
                      onChange={(v) => setFilterAll(v as any)}
                    />
                  )}
                </div>
                <SearchFilterSheet
                  open={showMobileFilters}
                  activeCount={activeFilterCount}
                  categories={
                    viewMode === 'agg'
                      ? filterOptions.categoriesAgg
                      : filterOptions.categoriesAll
                  }
                  values={viewMode === 'agg' ? filterAgg : filterAll}
                  onChange={(values) =>
                    viewMode === 'agg'
                      ? setFilterAgg({
                          ...values,
                          yearOrder: values.yearOrder as
                            'none' | 'asc' | 'desc',
                        })
                      : setFilterAll({
                          ...values,
                          yearOrder: values.yearOrder as
                            'none' | 'asc' | 'desc',
                        })
                  }
                  onOpen={() => setShowMobileFilters(true)}
                  onClose={() => setShowMobileFilters(false)}
                />
                <div className='flex items-center gap-3 shrink-0'>
                  <label className='flex items-center gap-2 cursor-pointer select-none'>
                    <span className='text-xs sm:text-sm text-zinc-700 dark:text-zinc-300'>
                      聚合
                    </span>
                    <div className='relative'>
                      <input
                        type='checkbox'
                        className='sr-only peer'
                        checked={viewMode === 'agg'}
                        onChange={() =>
                          setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                        }
                      />
                      <div className='w-9 h-5 bg-zinc-300 rounded-full peer-checked:bg-accent transition-colors dark:bg-zinc-600'></div>
                      <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                    </div>
                  </label>
                  <div className='flex items-center gap-1 border-l border-zinc-200 dark:border-zinc-800 pl-3'>
                    <button
                      type='button'
                      title='網格視圖'
                      onClick={() => handleLayoutModeChange('grid')}
                      className={`p-1.5 rounded-lg transition-colors ${
                        layoutMode === 'grid'
                          ? 'bg-accent text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                      }`}
                    >
                      <LayoutGrid className='w-4 h-4' />
                    </button>
                    <button
                      type='button'
                      title='列表視圖'
                      onClick={() => handleLayoutModeChange('list')}
                      className={`p-1.5 rounded-lg transition-colors ${
                        layoutMode === 'list'
                          ? 'bg-accent text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                      }`}
                    >
                      <List className='w-4 h-4' />
                    </button>
                  </div>
                </div>
              </div>
              {fuzzySearchResults.length === 0 ? (
                isLoading ? (
                  <div className='flex justify-center items-center h-40'>
                    <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-accent'></div>
                  </div>
                ) : (
                  <div className='flex flex-col items-center justify-center gap-3 px-6 py-16 text-center'>
                    <div className='flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/60'>
                      <Search className='h-6 w-6 text-zinc-400' />
                    </div>
                    <p className='text-base font-medium text-zinc-100'>
                      找不到「{submittedQuery || searchQuery}」的結果
                    </p>
                    <p className='max-w-sm text-sm leading-relaxed text-zinc-500'>
                      {triedMainlandLabel ? (
                        <>
                          系統已用中國片名
                          <span className='mx-1 font-medium text-zinc-300'>
                            「{triedMainlandLabel}」
                          </span>
                          搜過。可以點下方用該名稱再搜、試更簡短關鍵字，或關閉「聚合」。
                        </>
                      ) : (
                        <>
                          可以試試更簡短的關鍵字，或關閉上方的「聚合」以顯示各來源的個別結果。
                        </>
                      )}
                    </p>
                    <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
                      {triedMainlandLabel && (
                        <button
                          type='button'
                          onClick={() =>
                            handleRetryWithMainland(triedMainlandLabel)
                          }
                          className='rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/15'
                        >
                          用「{triedMainlandLabel}」再搜一次
                        </button>
                      )}
                      {viewMode === 'agg' && (
                        <button
                          type='button'
                          onClick={() => setViewMode('all')}
                          className='rounded-full border border-white/15 bg-zinc-900/40 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800/80'
                        >
                          關閉聚合再試一次
                        </button>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <div key={`search-results-${viewMode}-${layoutMode}`}>
                  {layoutMode === 'list' ? (
                    <div className='flex flex-col gap-2.5 pb-16'>
                      {viewMode === 'agg'
                        ? filteredAggResults.map(([mapKey, group]) => {
                            const title = group[0]?.title || '';
                            const poster = group[0]?.poster || '';
                            const year = group[0]?.year || 'unknown';
                            const { episodes, source_names, type_name } =
                              computeGroupStats(group);
                            const primary = group[0];
                            return (
                              <div
                                key={`list-agg-${mapKey}`}
                                onClick={() => {
                                  if (!primary) return;
                                  const playUrl = buildPlayUrl({
                                    source: primary.source,
                                    id: primary.id,
                                    title: title,
                                    year: year !== 'unknown' ? year : undefined,
                                    stype: episodes > 1 ? 'tv' : 'movie',
                                    stitle: resultQuery || undefined,
                                  });
                                  router.push(playUrl);
                                }}
                                className='group flex items-center justify-between gap-4 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-accent/40 transition-all cursor-pointer'
                              >
                                <div className='flex items-center gap-3.5 min-w-0'>
                                  <div className='relative w-12 h-16 rounded-lg overflow-hidden bg-zinc-800 shrink-0'>
                                    {poster ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={processImageUrl(poster)}
                                        alt={title}
                                        className='w-full h-full object-cover group-hover:scale-105 transition-transform'
                                        loading='lazy'
                                        onError={(e) => {
                                          const img = e.currentTarget;
                                          if (!img.dataset.retried && poster) {
                                            img.dataset.retried = 'true';
                                            img.src =
                                              getProxiedImageUrl(poster);
                                          }
                                        }}
                                      />
                                    ) : (
                                      <div className='w-full h-full flex items-center justify-center text-xs text-zinc-500'>
                                        無圖
                                      </div>
                                    )}
                                  </div>
                                  <div className='flex flex-col min-w-0'>
                                    <div className='flex items-center gap-2'>
                                      <span className='font-semibold text-zinc-100 text-sm sm:text-base group-hover:text-accent transition-colors truncate'>
                                        {title}
                                      </span>
                                      {year !== 'unknown' && (
                                        <span className='text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0 tabular-nums'>
                                          {year}
                                        </span>
                                      )}
                                      {type_name && (
                                        <span className='text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0'>
                                          {type_name}
                                        </span>
                                      )}
                                    </div>
                                    <div className='flex items-center gap-2 mt-1.5 text-xs text-zinc-400'>
                                      {episodes > 0 && (
                                        <span className='text-zinc-300 font-medium'>
                                          {episodes > 1
                                            ? `共 ${episodes} 集`
                                            : '單集 / 電影'}
                                        </span>
                                      )}
                                      <span className='text-zinc-600'>•</span>
                                      <span className='truncate text-zinc-400'>
                                        {source_names.slice(0, 4).join('、')}
                                        {source_names.length > 4
                                          ? ` 等 ${source_names.length} 個來源`
                                          : ' 來源'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className='shrink-0 flex items-center gap-2'>
                                  <button
                                    type='button'
                                    className='px-3.5 py-1.5 rounded-lg bg-accent/15 hover:bg-accent text-accent hover:text-white text-xs font-semibold transition-colors flex items-center gap-1.5'
                                  >
                                    <Play className='w-3.5 h-3.5 fill-current' />
                                    <span>播放</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        : filteredAllResults.map((item) => {
                            const count = getResultEpisodeCount(item);
                            return (
                              <div
                                key={`list-all-${item.source}-${item.id}`}
                                onClick={() => {
                                  const playUrl = buildPlayUrl({
                                    source: item.source,
                                    id: item.id,
                                    title: item.title,
                                    year:
                                      item.year && item.year !== 'unknown'
                                        ? item.year
                                        : undefined,
                                    stype: count > 1 ? 'tv' : 'movie',
                                    stitle: resultQuery || undefined,
                                  });
                                  router.push(playUrl);
                                }}
                                className='group flex items-center justify-between gap-4 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-accent/40 transition-all cursor-pointer'
                              >
                                <div className='flex items-center gap-3.5 min-w-0'>
                                  <div className='relative w-12 h-16 rounded-lg overflow-hidden bg-zinc-800 shrink-0'>
                                    {item.poster ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={processImageUrl(item.poster)}
                                        alt={item.title}
                                        className='w-full h-full object-cover group-hover:scale-105 transition-transform'
                                        loading='lazy'
                                        onError={(e) => {
                                          const img = e.currentTarget;
                                          if (
                                            !img.dataset.retried &&
                                            item.poster
                                          ) {
                                            img.dataset.retried = 'true';
                                            img.src = getProxiedImageUrl(
                                              item.poster
                                            );
                                          }
                                        }}
                                      />
                                    ) : (
                                      <div className='w-full h-full flex items-center justify-center text-xs text-zinc-500'>
                                        無圖
                                      </div>
                                    )}
                                  </div>
                                  <div className='flex flex-col min-w-0'>
                                    <div className='flex items-center gap-2'>
                                      <span className='font-semibold text-zinc-100 text-sm sm:text-base group-hover:text-accent transition-colors truncate'>
                                        {item.title}
                                      </span>
                                      {item.year && item.year !== 'unknown' && (
                                        <span className='text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0 tabular-nums'>
                                          {item.year}
                                        </span>
                                      )}
                                      {item.type_name && (
                                        <span className='text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0'>
                                          {item.type_name}
                                        </span>
                                      )}
                                    </div>
                                    <div className='flex items-center gap-2 mt-1.5 text-xs text-zinc-400'>
                                      {count > 0 && (
                                        <span className='text-zinc-300 font-medium'>
                                          {count > 1
                                            ? `共 ${count} 集`
                                            : '單集 / 電影'}
                                        </span>
                                      )}
                                      <span className='text-zinc-600'>•</span>
                                      <span className='text-zinc-400'>
                                        來源：{item.source_name || item.source}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className='shrink-0 flex items-center gap-2'>
                                  <button
                                    type='button'
                                    className='px-3.5 py-1.5 rounded-lg bg-accent/15 hover:bg-accent text-accent hover:text-white text-xs font-semibold transition-colors flex items-center gap-1.5'
                                  >
                                    <Play className='w-3.5 h-3.5 fill-current' />
                                    <span>播放</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                    </div>
                  ) : viewMode === 'agg' ? (
                    <VirtualGrid
                      items={filteredAggResults}
                      className='grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
                      rowGapClass='pb-14 sm:pb-20'
                      estimateRowHeight={320}
                      renderItem={([mapKey, group]) => {
                        const title = group[0]?.title || '';
                        const poster = group[0]?.poster || '';
                        const year = group[0]?.year || 'unknown';
                        const { episodes, source_names, douban_id, type_name } =
                          computeGroupStats(group);
                        const type = episodes === 1 ? 'movie' : 'tv';
                        if (!groupStatsRef.current.has(mapKey)) {
                          groupStatsRef.current.set(mapKey, {
                            episodes,
                            source_names,
                            douban_id,
                          });
                        }
                        return (
                          <div key={`agg-${mapKey}`} className='w-full'>
                            <VideoCard
                              ref={getGroupRef(mapKey)}
                              from='search'
                              isAggregate={true}
                              title={title}
                              poster={poster}
                              year={year}
                              episodes={episodes || undefined}
                              source_names={source_names}
                              douban_id={douban_id}
                              query={resultQuery !== title ? resultQuery : ''}
                              type={type}
                              type_name={type_name}
                            />
                          </div>
                        );
                      }}
                    />
                  ) : (
                    <VirtualGrid
                      items={filteredAllResults}
                      className='grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
                      rowGapClass='pb-14 sm:pb-20'
                      estimateRowHeight={320}
                      renderItem={(item) => (
                        <div
                          key={`all-${item.source}-${item.id}`}
                          className='w-full'
                        >
                          <VideoCard
                            id={item.id}
                            title={item.title}
                            poster={item.poster}
                            episodes={getResultEpisodeCount(item) || undefined}
                            source={item.source}
                            source_name={item.source_name}
                            douban_id={item.douban_id}
                            query={
                              resultQuery !== item.title ? resultQuery : ''
                            }
                            year={item.year}
                            from='search'
                            type={
                              getResultEpisodeCount(item) > 1 ? 'tv' : 'movie'
                            }
                            type_name={item.type_name}
                          />
                        </div>
                      )}
                    />
                  )}
                </div>
              )}
            </section>
          ) : (
            <section className='mb-12 flex flex-col items-center justify-center min-h-[42vh] px-4'>
              <div className='w-16 h-16 bg-zinc-100 dark:bg-surface-panel rounded-2xl flex items-center justify-center mb-5 border border-zinc-200/60 dark:border-white/10'>
                <Search className='w-8 h-8 text-zinc-400 dark:text-zinc-500' />
              </div>
              <h2 className='text-xl font-bold text-zinc-800 dark:text-zinc-100 mb-2'>
                探索影音世界
              </h2>
              <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-6 text-center max-w-sm leading-relaxed'>
                輸入片名搜尋；支援繁中與陸源譯名。點選下方熱門關鍵字可立刻開始。
              </p>
              <div className='flex flex-wrap justify-center gap-2 max-w-lg'>
                {[
                  '進擊的巨人',
                  '鬼滅之刃',
                  '咒術迴戰',
                  '葬送的芙莉蓮',
                  '奧術',
                  '吉伊卡哇',
                ].map((kw) => (
                  <button
                    key={kw}
                    type='button'
                    onClick={() => {
                      setSearchQuery(kw);
                      setIsLoading(true);
                      setShowResults(true);
                      setShowSuggestions(false);
                      router.push(`/search?q=${encodeURIComponent(kw)}`);
                    }}
                    className='rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-800/60 px-3.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:border-accent/40 hover:text-accent transition-colors'
                  >
                    {kw}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-accent/90 hover:bg-accent text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回頂部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SearchPageClient />
    </Suspense>
  );
}
