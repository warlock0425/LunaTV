/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import {
  getDoubanCategories,
  getDoubanCategoriesFromServer,
  getDoubanList,
  getDoubanListFromServer,
  getDoubanRecommends,
  getDoubanRecommendsFromServer,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';
import { useClientValue } from '@/hooks/useClientMount';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import PageLoading from '@/components/PageLoading';
import VideoCard from '@/components/VideoCard';
import VirtualGrid from '@/components/VirtualGrid';

const EMPTY_CUSTOM_CATEGORIES: Array<{
  name: string;
  type: 'movie' | 'tv';
  query: string;
}> = [];

function doubanScrollStorageKey(parts: {
  type: string;
  primarySelection: string;
  secondarySelection: string;
  selectedWeekday: string;
  multiLevelValues: Record<string, string>;
}): string {
  const raw = [
    parts.type,
    parts.primarySelection,
    parts.secondarySelection,
    parts.selectedWeekday,
    JSON.stringify(parts.multiLevelValues),
  ].join('|');
  return `luna_douban_scroll_${encodeURIComponent(raw)}`;
}

function DoubanPageClient() {
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 用於儲存最新參數值的 refs
  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  const type = searchParams.get('type') || 'movie';

  // 取得 runtimeConfig 中的自定義分類資料
  const customCategories = useClientValue<
    Array<{ name: string; type: 'movie' | 'tv'; query: string }>
  >(() => {
    const rc = window.RUNTIME_CONFIG?.CUSTOM_CATEGORIES;
    // 空清單回傳與伺服器快照相同的穩定參考，避免 hydration 快照不一致
    return rc && rc.length > 0 ? rc : EMPTY_CUSTOM_CATEGORIES;
  }, EMPTY_CUSTOM_CATEGORIES);

  // 選擇器狀態 - 完全獨立，不依賴URL參數
  const [primarySelection, setPrimarySelection] = useState<string>(() => {
    if (type === 'movie') return '熱門';
    if (type === 'tv' || type === 'show') return '最近熱門';
    if (type === 'anime') return '每日放送';
    return '';
  });
  const [secondarySelection, setSecondarySelection] = useState<string>(() => {
    if (type === 'movie') return '全部';
    if (type === 'tv') return 'tv';
    if (type === 'show') return 'show';
    return '全部';
  });

  // MultiLevelSelector 狀態
  const [multiLevelValues, setMultiLevelValues] = useState<
    Record<string, string>
  >({
    type: 'all',
    region: 'all',
    year: 'all',
    platform: 'all',
    label: 'all',
    sort: 'T',
  });

  // 星期選擇器狀態
  const [selectedWeekday, setSelectedWeekday] = useState<string>('');

  // 同步最新參數值到 ref
  useEffect(() => {
    currentParamsRef.current = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage,
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    currentPage,
  ]);

  const doubanScrollKey = doubanScrollStorageKey({
    type,
    primarySelection,
    secondarySelection,
    selectedWeekday,
    multiLevelValues,
  });
  const restoredDoubanScrollKeyRef = useRef('');

  useEffect(() => {
    const handleScroll = () => {
      try {
        sessionStorage.setItem(doubanScrollKey, String(window.scrollY));
      } catch {
        // ignore
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [doubanScrollKey]);

  useEffect(() => {
    if (loading || !selectorsReady || doubanData.length === 0) return;
    if (restoredDoubanScrollKeyRef.current === doubanScrollKey) return;
    restoredDoubanScrollKeyRef.current = doubanScrollKey;
    try {
      const savedScroll = sessionStorage.getItem(doubanScrollKey);
      if (savedScroll && Number(savedScroll) > 0) {
        window.scrollTo({ top: Number(savedScroll), behavior: 'instant' });
      }
    } catch {
      // ignore
    }
  }, [loading, selectorsReady, doubanData.length, doubanScrollKey]);

  // 初始化時標記選擇器為準備好狀態
  useEffect(() => {
    // 短暫延遲確保初始狀態設定完成
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, []); // 只在組件掛載時執行一次

  // type / customCategories 變化時重置選擇器（render 期調整狀態，
  // 取代原本兩個 setState-in-effect；50ms 後標記就緒的計時器留在 effect）。
  // 注意：customCategories 來自 useSyncExternalStore，hydration 完成時
  // 伺服器快照與客戶端快照的「參考」可能不同但內容相同（如空陣列）；
  // 以「內容鍵」比較可避免每次整頁載入都多做一輪無意義的重置與重新抓取。
  const categoriesKey = customCategories
    .map((cat) => `${cat.type}:${cat.query}`)
    .join('|');
  const [prevSelectorKey, setPrevSelectorKey] = useState<{
    type: string;
    categoriesKey: string;
  }>({ type, categoriesKey });
  if (
    type !== prevSelectorKey.type ||
    categoriesKey !== prevSelectorKey.categoriesKey
  ) {
    setPrevSelectorKey({ type, categoriesKey });
    setSelectorsReady(false);
    setLoading(true);

    if (type === 'custom' && customCategories.length > 0) {
      // 自定義分類模式：優先選擇 movie，如果沒有 movie 則選擇 tv
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type))
      );
      if (types.length > 0) {
        const selectedType = types.includes('movie') ? 'movie' : 'tv';
        setPrimarySelection(selectedType);
        const firstCategory = customCategories.find(
          (cat) => cat.type === selectedType
        );
        if (firstCategory) {
          setSecondarySelection(firstCategory.query);
        }
      }
    } else if (type === 'movie') {
      setPrimarySelection('熱門');
      setSecondarySelection('全部');
    } else if (type === 'tv') {
      setPrimarySelection('最近熱門');
      setSecondarySelection('tv');
    } else if (type === 'show') {
      setPrimarySelection('最近熱門');
      setSecondarySelection('show');
    } else if (type === 'anime') {
      setPrimarySelection('每日放送');
      setSecondarySelection('全部');
    } else {
      setPrimarySelection('');
      setSecondarySelection('全部');
    }

    // 清空 MultiLevelSelector 狀態
    setMultiLevelValues({
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    });
  }

  // 選擇器重置後短暫延遲標記就緒（非同步 setState，允許於 effect）
  useEffect(() => {
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [type, categoriesKey]);

  // 生成骨架屏資料
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  // 參數快照比較函數
  const isSnapshotEqual = useCallback(
    (
      snapshot1: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      },
      snapshot2: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      }
    ) => {
      return (
        snapshot1.type === snapshot2.type &&
        snapshot1.primarySelection === snapshot2.primarySelection &&
        snapshot1.secondarySelection === snapshot2.secondarySelection &&
        snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
        snapshot1.currentPage === snapshot2.currentPage &&
        JSON.stringify(snapshot1.multiLevelSelection) ===
          JSON.stringify(snapshot2.multiLevelSelection)
      );
    },
    []
  );

  // 生成API請求參數的輔助函數
  const getRequestParams = useCallback(
    (pageStart: number) => {
      // 當type為tv或show時，kind統一為'tv'，category使用type本身
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }

      // 電影類型保持原邏輯
      return {
        kind: type as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        pageLimit: 25,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection]
  );

  const getAnimeDoubanData = useCallback(
    async (pageStart: number) => {
      const recommendedData = await getDoubanRecommendsFromServer({
        kind: primarySelection === '番劇' ? 'tv' : 'movie',
        pageLimit: 25,
        pageStart,
        category: '動畫',
        format: primarySelection === '番劇' ? '電視劇' : '',
        region: (multiLevelValues.region as string) || '',
        year: (multiLevelValues.year as string) || '',
        platform: (multiLevelValues.platform as string) || '',
        sort: (multiLevelValues.sort as string) || '',
        label: (multiLevelValues.label as string) || '',
      });

      if (recommendedData.code === 200 && recommendedData.list.length > 0) {
        return recommendedData;
      }

      if (primarySelection === '番劇') {
        const recentData = await getDoubanCategoriesFromServer({
          kind: 'tv',
          category: '全部',
          type: 'tv_animation',
          pageLimit: 25,
          pageStart,
        });

        if (recentData.code === 200 && recentData.list.length > 0) {
          return recentData;
        }
      }

      return getDoubanListFromServer({
        tag: '動畫',
        type: primarySelection === '番劇' ? 'tv' : 'movie',
        pageLimit: 25,
        pageStart,
      });
    },
    [primarySelection, multiLevelValues]
  );

  // 防抖的資料載入函數
  const loadInitialData = useCallback(async () => {
    // 創建當前參數的快照
    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage: 0,
    };

    try {
      setLoading(true);
      setError(null);
      // 確保在載入初始資料時重置頁面狀態
      setDoubanData([]);
      setCurrentPage(0);
      setHasMore(true);
      setIsLoadingMore(false);

      let data: DoubanResult;

      if (type === 'custom') {
        // 自定義分類模式：根據選中的一級和二級選項取得對應的分類
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection
        );

        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 25,
            pageStart: 0,
          });
        } else {
          throw new Error('沒有找到對應的分類');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendarData = await GetBangumiCalendarData();
        const weekdayData = calendarData.find(
          (item) => item.weekday.en === selectedWeekday
        );
        if (weekdayData) {
          data = {
            code: 200,
            message: 'success',
            list: weekdayData.items.map((item) => ({
              id: item.id?.toString() || '',
              title: item.name_cn || item.name,
              original_title: item.name,
              poster:
                item.images.large ||
                item.images.common ||
                item.images.medium ||
                item.images.small ||
                item.images.grid,
              rate: item.rating?.score?.toFixed(1) || '',
              year: item.air_date?.split('-')?.[0] || '',
            })),
          };
        } else {
          throw new Error('沒有找到對應的日期');
        }
      } else if (type === 'anime') {
        data = await getAnimeDoubanData(0);
      } else if (primarySelection === '全部') {
        data = await getDoubanRecommends({
          kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
          pageLimit: 25,
          pageStart: 0, // 初始資料載入始終從第一頁開始
          category: multiLevelValues.type
            ? (multiLevelValues.type as string)
            : '',
          format: type === 'show' ? '綜藝' : type === 'tv' ? '電視劇' : '',
          region: multiLevelValues.region
            ? (multiLevelValues.region as string)
            : '',
          year: multiLevelValues.year ? (multiLevelValues.year as string) : '',
          platform: multiLevelValues.platform
            ? (multiLevelValues.platform as string)
            : '',
          sort: multiLevelValues.sort ? (multiLevelValues.sort as string) : '',
          label: multiLevelValues.label
            ? (multiLevelValues.label as string)
            : '',
        });
      } else {
        data = await getDoubanCategories(getRequestParams(0));
      }

      if (data.code === 200) {
        // 檢查參數是否仍然一致，如果一致才設定資料
        // 使用 ref 取得最新的當前值
        const currentSnapshot = { ...currentParamsRef.current };

        if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
          setDoubanData(data.list);
          setHasMore(data.list.length !== 0);
          setLoading(false);
        } else {
          // 參數不一致，不執行任何操作，避免設定過期資料
        }
        // 如果參數不一致，不執行任何操作，避免設定過期資料
      } else {
        throw new Error(data.message || '取得資料失敗');
      }
    } catch (err) {
      // 僅在請求參數仍與當前一致時才呈現錯誤，避免過期請求覆蓋新狀態
      const currentSnapshot = { ...currentParamsRef.current };
      if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
        setError((err as Error).message || '取得資料失敗，請稍後重試');
        setLoading(false);
      }
    }
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    getRequestParams,
    getAnimeDoubanData,
    customCategories,
  ]);

  // 只在選擇器準備好後才載入資料
  useEffect(() => {
    // 只有在選擇器準備好時才開始載入
    if (!selectorsReady) {
      return;
    }

    // 清除之前的防抖定時器
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // 使用防抖機製載入資料，避免連續狀態更新觸發多次請求
    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData();
    }, 100); // 100ms 防抖延遲

    // 清理函數
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    selectorsReady,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    loadInitialData,
  ]);

  // 單獨處理 currentPage 變化（載入更多）
  useEffect(() => {
    if (currentPage > 0) {
      const fetchMoreData = async () => {
        // 創建當前參數的快照
        const requestSnapshot = {
          type,
          primarySelection,
          secondarySelection,
          multiLevelSelection: multiLevelValues,
          selectedWeekday,
          currentPage,
        };

        try {
          setIsLoadingMore(true);

          let data: DoubanResult;
          if (type === 'custom') {
            // 自定義分類模式：根據選中的一級和二級選項取得對應的分類
            const selectedCategory = customCategories.find(
              (cat) =>
                cat.type === primarySelection &&
                cat.query === secondarySelection
            );

            if (selectedCategory) {
              data = await getDoubanList({
                tag: selectedCategory.query,
                type: selectedCategory.type,
                pageLimit: 25,
                pageStart: currentPage * 25,
              });
            } else {
              throw new Error('沒有找到對應的分類');
            }
          } else if (type === 'anime' && primarySelection === '每日放送') {
            // 每日放送模式下，不進行資料請求，返回空資料
            data = {
              code: 200,
              message: 'success',
              list: [],
            };
          } else if (type === 'anime') {
            data = await getAnimeDoubanData(currentPage * 25);
          } else if (primarySelection === '全部') {
            data = await getDoubanRecommends({
              kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
              pageLimit: 25,
              pageStart: currentPage * 25,
              category: multiLevelValues.type
                ? (multiLevelValues.type as string)
                : '',
              format: type === 'show' ? '綜藝' : type === 'tv' ? '電視劇' : '',
              region: multiLevelValues.region
                ? (multiLevelValues.region as string)
                : '',
              year: multiLevelValues.year
                ? (multiLevelValues.year as string)
                : '',
              platform: multiLevelValues.platform
                ? (multiLevelValues.platform as string)
                : '',
              sort: multiLevelValues.sort
                ? (multiLevelValues.sort as string)
                : '',
              label: multiLevelValues.label
                ? (multiLevelValues.label as string)
                : '',
            });
          } else {
            data = await getDoubanCategories(
              getRequestParams(currentPage * 25)
            );
          }

          if (data.code === 200) {
            // 檢查參數是否仍然一致，如果一致才設定資料
            // 使用 ref 取得最新的當前值
            const currentSnapshot = { ...currentParamsRef.current };

            if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
              setDoubanData((prev) => [...prev, ...data.list]);
              setHasMore(data.list.length !== 0);
            } else {
              // 參數不一致，不執行任何操作，避免設定過期資料
            }
          } else {
            throw new Error(data.message || '取得資料失敗');
          }
        } catch (err) {
          // 忽略錯誤，載入更多失敗不影響現有資料
        } finally {
          if (
            isSnapshotEqual(requestSnapshot, { ...currentParamsRef.current })
          ) {
            setIsLoadingMore(false);
          }
        }
      };

      fetchMoreData();
    }
  }, [
    currentPage,
    type,
    primarySelection,
    secondarySelection,
    customCategories,
    multiLevelValues,
    selectedWeekday,
    getAnimeDoubanData,
  ]);

  // 設定滾動監聽
  useEffect(() => {
    // 如果沒有更多資料或正在載入，則不設定監聽
    if (!hasMore || isLoadingMore || loading) {
      return;
    }

    // 確保 loadingRef 存在
    if (!loadingRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, loading]);

  // 處理選擇器變化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      // 只有當值真正改變時才設定loading狀態
      if (value !== primarySelection) {
        setLoading(true);
        // 立即重置頁面狀態，防止基於舊狀態的請求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);

        // 清空 MultiLevelSelector 狀態
        setMultiLevelValues({
          type: 'all',
          region: 'all',
          year: 'all',
          platform: 'all',
          label: 'all',
          sort: 'T',
        });

        // 如果是自定義分類模式，同時更新一級和二級選擇器
        if (type === 'custom' && customCategories.length > 0) {
          const firstCategory = customCategories.find(
            (cat) => cat.type === value
          );
          if (firstCategory) {
            // 批量更新狀態，避免多次觸發資料載入
            setPrimarySelection(value);
            setSecondarySelection(firstCategory.query);
          } else {
            setPrimarySelection(value);
          }
        } else {
          // 電視劇和綜藝切換到"最近熱門"時，重置二級分類為第一個選項
          if ((type === 'tv' || type === 'show') && value === '最近熱門') {
            setPrimarySelection(value);
            if (type === 'tv') {
              setSecondarySelection('tv');
            } else if (type === 'show') {
              setSecondarySelection('show');
            }
          } else {
            setPrimarySelection(value);
          }
        }
      }
    },
    [primarySelection, type, customCategories]
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      // 只有當值真正改變時才設定loading狀態
      if (value !== secondarySelection) {
        setLoading(true);
        // 立即重置頁面狀態，防止基於舊狀態的請求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);
        setSecondarySelection(value);
      }
    },
    [secondarySelection]
  );

  const handleMultiLevelChange = useCallback(
    (values: Record<string, string>) => {
      // 比較兩個對象是否相同，忽略順序
      const isEqual = (
        obj1: Record<string, string>,
        obj2: Record<string, string>
      ) => {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();

        if (keys1.length !== keys2.length) return false;

        return keys1.every((key) => obj1[key] === obj2[key]);
      };

      // 如果相同，則不設定loading狀態
      if (isEqual(values, multiLevelValues)) {
        return;
      }

      setLoading(true);
      // 立即重置頁面狀態，防止基於舊狀態的請求
      setCurrentPage(0);
      setDoubanData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      setMultiLevelValues(values);
    },
    [multiLevelValues]
  );

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  const getPageTitle = () => {
    // 根據 type 生成標題
    return type === 'movie'
      ? '電影'
      : type === 'tv'
        ? '電視劇'
        : type === 'anime'
          ? '動漫'
          : type === 'show'
            ? '綜藝'
            : '自定義';
  };

  const getPageDescription = () => {
    if (type === 'anime' && primarySelection === '每日放送') {
      return '來自 Bangumi 番組計劃的精選內容';
    }
    return '來自豆瓣的精選內容';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 頁面標題和選擇器 */}
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          {/* 頁面標題 */}
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-white mb-1 sm:mb-2'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-zinc-500 dark:text-zinc-400'>
              {getPageDescription()}
            </p>
          </div>

          {/* 手機端篩選切換按鈕 */}
          <div className='sm:hidden'>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className='w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-zinc-900/60 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-700 dark:text-zinc-300'
            >
              <span>篩選條件</span>
              <svg
                className={`w-4 h-4 transition-transform ${
                  showFilters ? 'rotate-180' : ''
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M19 9l-7 7-7-7'
                />
              </svg>
            </button>
          </div>

          {/* 選擇器組件 */}
          <div className={`${showFilters ? 'block' : 'hidden'} sm:block`}>
            {type !== 'custom' ? (
              <div className='bg-white/80 dark:bg-anime-dark/80 rounded-xl p-3 sm:p-4 border border-zinc-200 dark:border-white/5 backdrop-blur-sm'>
                <DoubanSelector
                  type={type as 'movie' | 'tv' | 'show' | 'anime'}
                  primarySelection={primarySelection}
                  secondarySelection={secondarySelection}
                  onPrimaryChange={handlePrimaryChange}
                  onSecondaryChange={handleSecondaryChange}
                  onMultiLevelChange={handleMultiLevelChange}
                  onWeekdayChange={handleWeekdayChange}
                />
              </div>
            ) : (
              <div className='bg-white/80 dark:bg-anime-dark/80 rounded-xl p-3 sm:p-4 border border-zinc-200 dark:border-white/5 backdrop-blur-sm'>
                <DoubanCustomSelector
                  customCategories={customCategories}
                  primarySelection={primarySelection}
                  secondarySelection={secondarySelection}
                  onPrimaryChange={handlePrimaryChange}
                  onSecondaryChange={handleSecondaryChange}
                />
              </div>
            )}
          </div>
        </div>

        {/* 內容展示區域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          {/* 內容網格 */}
          {loading || !selectorsReady ? (
            // 顯示骨架屏
            <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
              {skeletonData.map((index) => (
                <DoubanCardSkeleton key={index} />
              ))}
            </div>
          ) : (
            // 顯示實際資料
            <VirtualGrid
              items={doubanData}
              className='grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8'
              rowGapClass='pb-12 sm:pb-20'
              estimateRowHeight={320}
              renderItem={(item, index) => (
                <div key={`${item.title}-${index}`} className='w-full'>
                  <VideoCard
                    from='douban'
                    title={item.title}
                    query={item.original_title}
                    poster={item.poster}
                    douban_id={Number(item.id)}
                    rate={item.rate}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''} // 電影類型嚴格控製，tv 不控
                    isBangumi={
                      type === 'anime' && primarySelection === '每日放送'
                    }
                  />
                </div>
              )}
            />
          )}

          {/* 載入更多指示器 */}
          {hasMore && !loading && (
            <div
              ref={(el) => {
                if (el && el.offsetParent !== null) {
                  (
                    loadingRef as React.MutableRefObject<HTMLDivElement | null>
                  ).current = el;
                }
              }}
              className='flex justify-center mt-12 py-8'
            >
              {isLoadingMore && (
                <div className='flex items-center gap-2'>
                  <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-accent'></div>
                  <span className='text-zinc-500 dark:text-zinc-400'>
                    載入中...
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 沒有更多資料提示 */}
          {!hasMore && doubanData.length > 0 && (
            <div className='text-center text-zinc-400 dark:text-zinc-500 py-8'>
              已載入全部內容
            </div>
          )}

          {/* 錯誤狀態 */}
          {!loading && error && (
            <div className='text-center py-16 flex flex-col items-center justify-center gap-4'>
              <div className='text-accent text-4xl'>⚠️</div>
              <p className='text-zinc-500 dark:text-zinc-400 text-sm max-w-md'>
                {error}
              </p>
              <button
                onClick={() => loadInitialData()}
                className='px-6 py-2 bg-accent text-white rounded-md text-sm font-medium hover:bg-accent-deep transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50'
              >
                重試一次
              </button>
            </div>
          )}

          {/* 空狀態 */}
          {!loading && !error && doubanData.length === 0 && (
            <div className='text-center text-zinc-400 dark:text-zinc-500 py-8'>
              暫無相關內容
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DoubanPageClient />
    </Suspense>
  );
}
