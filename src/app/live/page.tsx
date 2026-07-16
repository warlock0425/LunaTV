/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls, { ErrorData, Events } from 'hls.js';
import { Heart, Radio, Tv } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited as checkIsFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { parseCustomTimeFormat } from '@/lib/time';

import EpgScrollableRow from '@/components/EpgScrollableRow';
import PageLayout from '@/components/PageLayout';
import PageLoading from '@/components/PageLoading';

import { buildLiveLogoProxyUrl } from './live-url';

// 擴展 HTMLVideoElement 類型以支持 hls 屬性
declare global {
  interface HTMLVideoElement {
    hls?: Hls;
  }
}

// 直播頻道接口
interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

// 直播源接口
interface LiveSource {
  key: string;
  name: string;
  url: string; // m3u 地址
  ua?: string;
  epg?: string; // 節目單
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}

function LivePageClient() {
  // -----------------------------------------------------------------------------
  // 狀態變量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'loading' | 'fetching' | 'ready'
  >('loading');
  const [loadingMessage, setLoadingMessage] = useState('正在加載直播源...');
  const [error, setError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // 直播源相關
  const [liveSources, setLiveSources] = useState<LiveSource[]>([]);
  const [currentSource, setCurrentSource] = useState<LiveSource | null>(null);
  const currentSourceRef = useRef<LiveSource | null>(null);
  useEffect(() => {
    currentSourceRef.current = currentSource;
  }, [currentSource]);

  // 頻道相關
  const [currentChannels, setCurrentChannels] = useState<LiveChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<LiveChannel | null>(
    null
  );
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const [needLoadSource] = useState(searchParams.get('source'));
  const [needLoadChannel] = useState(searchParams.get('id'));

  // 播放器相關
  const [videoUrl, setVideoUrl] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [unsupportedType, setUnsupportedType] = useState<string | null>(null);

  // 切換直播源狀態
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);

  // 分組相關
  const [groupedChannels, setGroupedChannels] = useState<{
    [key: string]: LiveChannel[];
  }>({});
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  // Tab 切換
  const [activeTab, setActiveTab] = useState<'channels' | 'sources'>(
    'channels'
  );

  // 頻道列表收起狀態
  const [isChannelListCollapsed, setIsChannelListCollapsed] = useState(false);

  // 過濾後的頻道列表
  const [filteredChannels, setFilteredChannels] = useState<LiveChannel[]>([]);

  // 節目單資訊
  const [epgData, setEpgData] = useState<{
    tvgId: string;
    source: string;
    epgUrl: string;
    programs: Array<{
      start: string;
      end: string;
      title: string;
    }>;
  } | null>(null);

  // EPG 資料加載狀態
  const [isEpgLoading, setIsEpgLoading] = useState(false);

  // 收藏狀態
  const [favorited, setFavorited] = useState(false);
  const favoritedRef = useRef(false);
  const currentChannelRef = useRef<LiveChannel | null>(null);

  // EPG資料清洗函數 - 去除重疊的節目，保留時間較短的，只顯示今日節目
  const cleanEpgData = (
    programs: Array<{ start: string; end: string; title: string }>
  ) => {
    if (!programs || programs.length === 0) return programs;

    // 獲取今日日期（只考慮年月日，忽略時間）
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const todayEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );

    // 首先過濾出今日的節目（包括跨天節目）
    const todayPrograms = programs.filter((program) => {
      const programStart = parseCustomTimeFormat(program.start);
      const programEnd = parseCustomTimeFormat(program.end);

      // 獲取節目的日期範圍
      const programStartDate = new Date(
        programStart.getFullYear(),
        programStart.getMonth(),
        programStart.getDate()
      );
      const programEndDate = new Date(
        programEnd.getFullYear(),
        programEnd.getMonth(),
        programEnd.getDate()
      );

      // 如果節目的開始時間或結束時間在今天，或者節目跨越今天，都算作今天的節目
      return (
        (programStartDate >= todayStart && programStartDate < todayEnd) || // 開始時間在今天
        (programEndDate >= todayStart && programEndDate < todayEnd) || // 結束時間在今天
        (programStartDate < todayStart && programEndDate >= todayEnd) // 節目跨越今天（跨天節目）
      );
    });

    // 按開始時間排序
    const sortedPrograms = [...todayPrograms].sort((a, b) => {
      const startA = parseCustomTimeFormat(a.start).getTime();
      const startB = parseCustomTimeFormat(b.start).getTime();
      return startA - startB;
    });

    const cleanedPrograms: Array<{
      start: string;
      end: string;
      title: string;
    }> = [];

    for (let i = 0; i < sortedPrograms.length; i++) {
      const currentProgram = sortedPrograms[i];
      const currentStart = parseCustomTimeFormat(currentProgram.start);
      const currentEnd = parseCustomTimeFormat(currentProgram.end);

      // 檢查是否與已新增的節目重疊
      let hasOverlap = false;

      for (const existingProgram of cleanedPrograms) {
        const existingStart = parseCustomTimeFormat(existingProgram.start);
        const existingEnd = parseCustomTimeFormat(existingProgram.end);

        // 檢查時間重疊（考慮完整的日期和時間）
        if (
          (currentStart >= existingStart && currentStart < existingEnd) || // 當前節目開始時間在已存在節目時間段內
          (currentEnd > existingStart && currentEnd <= existingEnd) || // 當前節目結束時間在已存在節目時間段內
          (currentStart <= existingStart && currentEnd >= existingEnd) // 當前節目完全包含已存在節目
        ) {
          hasOverlap = true;
          break;
        }
      }

      // 如果沒有重疊，則新增該節目
      if (!hasOverlap) {
        cleanedPrograms.push(currentProgram);
      } else {
        // 如果有重疊，檢查是否需要替換已存在的節目
        for (let j = 0; j < cleanedPrograms.length; j++) {
          const existingProgram = cleanedPrograms[j];
          const existingStart = parseCustomTimeFormat(existingProgram.start);
          const existingEnd = parseCustomTimeFormat(existingProgram.end);

          // 檢查是否與當前節目重疊（考慮完整的日期和時間）
          if (
            (currentStart >= existingStart && currentStart < existingEnd) ||
            (currentEnd > existingStart && currentEnd <= existingEnd) ||
            (currentStart <= existingStart && currentEnd >= existingEnd)
          ) {
            // 計算節目時長
            const currentDuration =
              currentEnd.getTime() - currentStart.getTime();
            const existingDuration =
              existingEnd.getTime() - existingStart.getTime();

            // 如果當前節目時間更短，則替換已存在的節目
            if (currentDuration < existingDuration) {
              cleanedPrograms[j] = currentProgram;
            }
            break;
          }
        }
      }
    }

    return cleanedPrograms;
  };

  // 播放器引用
  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // 分組標籤滾動相關
  const groupContainerRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const channelListRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------------
  // 工具函數（Utils）
  // -----------------------------------------------------------------------------

  // 獲取直播源列表
  const fetchLiveSources = async () => {
    try {
      setLoadingStage('fetching');
      setLoadingMessage('正在獲取直播源...');

      // 獲取 AdminConfig 中的直播源資訊
      const response = await fetch('/api/live/sources');
      if (!response.ok) {
        throw new Error('獲取直播源失敗');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '獲取直播源失敗');
      }

      const sources = result.data;
      setLiveSources(sources);

      if (sources.length > 0) {
        // 預設選中第一個源
        const firstSource = sources[0];
        if (needLoadSource) {
          const foundSource = sources.find(
            (s: LiveSource) => s.key === needLoadSource
          );
          if (foundSource) {
            setCurrentSource(foundSource);
            await fetchChannels(foundSource);
          } else {
            setCurrentSource(firstSource);
            await fetchChannels(firstSource);
          }
        } else {
          setCurrentSource(firstSource);
          await fetchChannels(firstSource);
        }
      }

      setLoadingStage('ready');
      setLoadingMessage('✨ 準備就緒...');
      setLoading(false);
    } catch (err) {
      console.error('獲取直播源失敗:', err);
      // 不設定錯誤，而是顯示空狀態
      setLiveSources([]);
      setLoading(false);
    } finally {
      // 移除 URL 搜尋參數中的 source 和 id
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.delete('source');
      newSearchParams.delete('id');

      const newUrl = newSearchParams.toString()
        ? `?${newSearchParams.toString()}`
        : window.location.pathname;

      router.replace(newUrl);
    }
  };

  // 獲取頻道列表
  const fetchChannels = async (source: LiveSource) => {
    try {
      setIsVideoLoading(true);

      // 從 cachedLiveChannels 獲取頻道資訊
      const channelParams = new URLSearchParams({ source: source.key });
      const response = await fetch(
        `/api/live/channels?${channelParams.toString()}`
      );
      if (!response.ok) {
        throw new Error('獲取頻道列表失敗');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '獲取頻道列表失敗');
      }

      const channelsData = result.data;
      if (!channelsData || channelsData.length === 0) {
        // 不拋出錯誤，而是設定空頻道列表
        setCurrentChannels([]);
        setGroupedChannels({});
        setFilteredChannels([]);

        // 更新直播源的頻道數為 0
        setLiveSources((prevSources) =>
          prevSources.map((s) =>
            s.key === source.key ? { ...s, channelNumber: 0 } : s
          )
        );

        setIsVideoLoading(false);
        return;
      }

      // 轉換頻道資料格式
      const channels: LiveChannel[] = channelsData.map((channel: any) => ({
        id: channel.id,
        tvgId: channel.tvgId || channel.name,
        name: channel.name,
        logo: channel.logo,
        group: channel.group || '其他',
        url: channel.url,
      }));

      setCurrentChannels(channels);

      // 更新直播源的頻道數
      setLiveSources((prevSources) =>
        prevSources.map((s) =>
          s.key === source.key ? { ...s, channelNumber: channels.length } : s
        )
      );

      // 預設選中第一個頻道
      let selectedChannel: LiveChannel | null = null;
      if (channels.length > 0) {
        if (needLoadChannel) {
          const foundChannel = channels.find(
            (c: LiveChannel) => c.id === needLoadChannel
          );
          if (foundChannel) {
            selectedChannel = foundChannel;
            setCurrentChannel(foundChannel);
            setVideoUrl(foundChannel.url);
            // 延遲滾動到選中的頻道
            setTimeout(() => {
              scrollToChannel(foundChannel);
            }, 200);
          } else {
            selectedChannel = channels[0];
            setCurrentChannel(selectedChannel);
            setVideoUrl(selectedChannel.url);
          }
        } else {
          selectedChannel = channels[0];
          setCurrentChannel(selectedChannel);
          setVideoUrl(selectedChannel.url);
        }
      }

      // 按分組組織頻道
      const grouped = channels.reduce(
        (acc, channel) => {
          const group = channel.group || '其他';
          if (!acc[group]) {
            acc[group] = [];
          }
          acc[group].push(channel);
          return acc;
        },
        {} as { [key: string]: LiveChannel[] }
      );

      setGroupedChannels(grouped);

      // 預設選中當前加載的channel所在的分組，如果沒有則選中第一個分組
      let targetGroup = '';
      if (needLoadChannel) {
        const foundChannel = channels.find(
          (c: LiveChannel) => c.id === needLoadChannel
        );
        if (foundChannel) {
          targetGroup = foundChannel.group || '其他';
        }
      }

      // 如果目標分組不存在，則使用第一個分組
      if (!targetGroup || !grouped[targetGroup]) {
        targetGroup = Object.keys(grouped)[0] || '';
      }

      const targetChannels = targetGroup ? grouped[targetGroup] : channels;
      setFilteredChannels(targetChannels);

      if (targetGroup) {
        // 確保切換到頻道tab
        setActiveTab('channels');
        setSelectedGroup(targetGroup);

        // 使用更長的延遲，確保狀態更新完成
        const channelToScroll = selectedChannel;
        setTimeout(() => {
          if (
            channelToScroll &&
            targetChannels.some((channel) => channel.id === channelToScroll.id)
          ) {
            scrollToChannel(channelToScroll);
          } else if (channelListRef.current) {
            channelListRef.current.scrollTo({
              top: 0,
              behavior: 'smooth',
            });
          }
        }, 500); // 增加延遲時間，確保狀態更新完成
      }

      setIsVideoLoading(false);
    } catch (err) {
      console.error('獲取頻道列表失敗:', err);
      // 不設定錯誤，而是設定空頻道列表
      setCurrentChannels([]);
      setGroupedChannels({});
      setFilteredChannels([]);

      // 更新直播源的頻道數為 0
      setLiveSources((prevSources) =>
        prevSources.map((s) =>
          s.key === source.key ? { ...s, channelNumber: 0 } : s
        )
      );

      setIsVideoLoading(false);
    }
  };

  // 切換直播源
  const handleSourceChange = async (source: LiveSource) => {
    try {
      // 設定切換狀態，鎖住頻道切換器
      setIsSwitchingSource(true);

      // 首先銷燬當前播放器
      cleanupPlayer();

      // 重置不支持的類型狀態
      setUnsupportedType(null);

      // 清空節目單資訊
      setEpgData(null);

      setCurrentSource(source);
      await fetchChannels(source);
    } catch (err) {
      console.error('切換直播源失敗:', err);
      // 不設定錯誤，保持當前狀態
    } finally {
      // 切換完成，解鎖頻道切換器
      setIsSwitchingSource(false);
      // 自動切換到頻道 tab
      setActiveTab('channels');
    }
  };

  // 切換頻道
  const handleChannelChange = async (channel: LiveChannel) => {
    // 如果正在切換直播源，則禁用頻道切換
    if (isSwitchingSource) return;

    // 首先銷燬當前播放器
    cleanupPlayer();

    // 重置不支持的類型狀態
    setUnsupportedType(null);

    setCurrentChannel(channel);
    setVideoUrl(channel.url);

    // 自動滾動到選中的頻道位置
    setTimeout(() => {
      scrollToChannel(channel);
    }, 100);

    // 獲取節目單資訊
    const sourceForEpg = currentSourceRef.current;
    if (channel.tvgId && sourceForEpg) {
      try {
        setIsEpgLoading(true); // 開始加載 EPG 資料
        const epgParams = new URLSearchParams({
          source: sourceForEpg.key,
          tvgId: channel.tvgId,
        });
        const response = await fetch(`/api/live/epg?${epgParams.toString()}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            // 清洗EPG資料，去除重疊的節目
            const cleanedData = {
              ...result.data,
              programs: cleanEpgData(result.data.programs),
            };
            setEpgData(cleanedData);
          }
        }
      } catch (error) {
        console.error('獲取節目單資訊失敗:', error);
      } finally {
        setIsEpgLoading(false); // 無論成功失敗都結束加載狀態
      }
    } else {
      // 如果沒有 tvgId 或 currentSource，清空 EPG 資料
      setEpgData(null);
      setIsEpgLoading(false);
    }
  };

  // 滾動到指定頻道位置的函數
  const scrollToChannel = (channel: LiveChannel) => {
    if (!channelListRef.current) return;

    // 使用 data 屬性來查找頻道元素
    const targetElement = Array.from(
      channelListRef.current.querySelectorAll<HTMLButtonElement>(
        '[data-channel-id]'
      )
    ).find((element) => element.dataset.channelId === channel.id);

    if (targetElement) {
      // 計算滾動位置，使頻道居中顯示
      const container = channelListRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = targetElement.getBoundingClientRect();

      // 計算目標滾動位置
      const scrollTop =
        container.scrollTop +
        (elementRect.top - containerRect.top) -
        containerRect.height / 2 +
        elementRect.height / 2;

      // 平滑滾動到目標位置
      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth',
      });
    }
  };

  // 清理播放器資源的統一函數
  const cleanupPlayer = () => {
    // 重置不支持的類型狀態
    setUnsupportedType(null);

    if (artPlayerRef.current) {
      try {
        // 先暫停播放
        if (artPlayerRef.current.video) {
          artPlayerRef.current.video.pause();
          artPlayerRef.current.video.src = '';
          artPlayerRef.current.video.load();
        }

        // 銷燬 HLS 實例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
          artPlayerRef.current.video.hls = undefined;
        }

        // 銷燬 FLV 實例 - 增強清理邏輯
        if (artPlayerRef.current.video && artPlayerRef.current.video.flv) {
          try {
            // 先停止加載
            if (artPlayerRef.current.video.flv.unload) {
              artPlayerRef.current.video.flv.unload();
            }
            // 銷燬播放器
            artPlayerRef.current.video.flv.destroy();
            // 確保引用被清空
            artPlayerRef.current.video.flv = null;
          } catch (flvError) {
            console.warn('FLV實例銷燬時出錯:', flvError);
            // 強製清空引用
            artPlayerRef.current.video.flv = null;
          }
        }

        // 移除所有事件監聽器
        artPlayerRef.current.off('ready');
        artPlayerRef.current.off('loadstart');
        artPlayerRef.current.off('loadeddata');
        artPlayerRef.current.off('canplay');
        artPlayerRef.current.off('waiting');
        artPlayerRef.current.off('error');

        // 銷燬 ArtPlayer 實例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      } catch (err) {
        console.warn('清理播放器資源時出錯:', err);
        artPlayerRef.current = null;
      }
    }
  };

  // 確保影片源正確設定
  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除舊的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始終允許遠程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾經有禁用屬性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 切換分組
  const handleGroupChange = (group: string) => {
    // 如果正在切換直播源，則禁用分組切換
    if (isSwitchingSource) return;

    setSelectedGroup(group);
    const filtered = currentChannels.filter(
      (channel) => channel.group === group
    );
    setFilteredChannels(filtered);

    // 如果當前選中的頻道在新的分組中，自動滾動到該頻道位置
    if (
      currentChannel &&
      filtered.some((channel) => channel.id === currentChannel.id)
    ) {
      setTimeout(() => {
        scrollToChannel(currentChannel);
      }, 100);
    } else {
      // 否則滾動到頻道列表頂端
      if (channelListRef.current) {
        channelListRef.current.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    }
  };

  // 切換收藏
  const handleToggleFavorite = async () => {
    if (!currentSourceRef.current || !currentChannelRef.current) return;

    try {
      const currentFavorited = favoritedRef.current;
      const newFavorited = !currentFavorited;

      // 立即更新狀態
      setFavorited(newFavorited);
      favoritedRef.current = newFavorited;

      // 異步執行收藏操作
      try {
        if (newFavorited) {
          // 如果未收藏，新增收藏
          await saveFavorite(
            `live_${currentSourceRef.current.key}`,
            `live_${currentChannelRef.current.id}`,
            {
              title: currentChannelRef.current.name,
              source_name: currentSourceRef.current.name,
              year: '',
              cover: buildLiveLogoProxyUrl(
                currentChannelRef.current.logo,
                currentSourceRef.current.key
              ),
              total_episodes: 1,
              save_time: Date.now(),
              search_title: '',
              origin: 'live',
            }
          );
        } else {
          // 如果已收藏，刪除收藏
          await deleteFavorite(
            `live_${currentSourceRef.current.key}`,
            `live_${currentChannelRef.current.id}`
          );
        }
      } catch (err) {
        console.error('收藏操作失敗:', err);
        // 如果操作失敗，回滾狀態
        setFavorited(currentFavorited);
        favoritedRef.current = currentFavorited;
      }
    } catch (err) {
      console.error('切換收藏失敗:', err);
    }
  };

  // 初始化
  useEffect(() => {
    fetchLiveSources();
  }, []);

  // 檢查收藏狀態
  useEffect(() => {
    if (!currentSource || !currentChannel) return;
    (async () => {
      try {
        const fav = await checkIsFavorited(
          `live_${currentSource.key}`,
          `live_${currentChannel.id}`
        );
        setFavorited(fav);
        favoritedRef.current = fav;
      } catch (err) {
        console.error('檢查收藏狀態失敗:', err);
      }
    })();
  }, [currentSource, currentChannel]);

  // 監聽收藏資料更新事件
  useEffect(() => {
    if (!currentSource || !currentChannel) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(
          `live_${currentSource.key}`,
          `live_${currentChannel.id}`
        );
        const isFav = !!favorites[key];
        setFavorited(isFav);
        favoritedRef.current = isFav;
      }
    );

    return unsubscribe;
  }, [currentSource, currentChannel]);

  // 當分組切換時，將激活的分組標籤滾動到視口中間
  useEffect(() => {
    if (!selectedGroup || !groupContainerRef.current) return;

    const groupKeys = Object.keys(groupedChannels);
    const groupIndex = groupKeys.indexOf(selectedGroup);
    if (groupIndex === -1) return;

    const btn = groupButtonRefs.current[groupIndex];
    const container = groupContainerRef.current;
    if (btn && container) {
      // 手動計算滾動位置，只滾動分組標籤容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 計算按鈕相對於容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 計算目標滾動位置，使按鈕居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滾動到目標位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [selectedGroup, groupedChannels]);

  // 分組標籤：滑鼠滾輪轉水平滾動（用 useEffect 清潔實作，取代 monkey patch）
  useEffect(() => {
    const container = groupContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (container.scrollWidth > container.clientWidth) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const CustomHlsJsLoader = useMemo(
    () =>
      class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
        constructor(config: any) {
          super(config);
          const load = this.load.bind(this);
          this.load = function (context: any, config: any, callbacks: any) {
            // 所有的請求都帶一個 source 參數
            try {
              const url = new URL(context.url);
              url.searchParams.set(
                'moontv-source',
                currentSourceRef.current?.key || ''
              );
              context.url = url.toString();
            } catch (error) {
              // ignore
            }
            // 攔截manifest和level請求
            if (
              (context as any).type === 'manifest' ||
              (context as any).type === 'level'
            ) {
              // 判斷是否瀏覽器直連
              const isLiveDirectConnectStr =
                localStorage.getItem('iptvDirectConnect') ??
                localStorage.getItem('liveDirectConnect');
              const isLiveDirectConnect = isLiveDirectConnectStr === 'true';
              if (isLiveDirectConnect) {
                // 瀏覽器直連，使用 URL 對象處理參數
                try {
                  const url = new URL(context.url);
                  url.searchParams.set('allowCORS', 'true');
                  context.url = url.toString();
                } catch (error) {
                  // 如果 URL 解析失敗，回退到字符串拼接
                  context.url = context.url + '&allowCORS=true';
                }
              }
            }
            // 執行原始load方法
            load(context, config, callbacks);
          };
        }
      },
    []
  );

  function m3u8Loader(video: HTMLVideoElement, url: string) {
    if (!Hls) {
      console.error('HLS.js 未加載');
      return;
    }

    // 清理之前的 HLS 實例
    if (video.hls) {
      try {
        video.hls.destroy();
        video.hls = undefined;
      } catch (err) {
        console.warn('清理 HLS 實例時出錯:', err);
      }
    }

    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      maxBufferLength: 30,
      backBufferLength: 30,
      maxBufferSize: 60 * 1000 * 1000,
      loader: CustomHlsJsLoader,
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    video.hls = hls;

    hls.on(Hls.Events.ERROR, function (event: Events.ERROR, data: ErrorData) {
      console.error('HLS Error:', event, data);

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            // hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      }
    });
  }

  // 播放器初始化
  useEffect(() => {
    const preload = async () => {
      if (
        !Artplayer ||
        !Hls ||
        !videoUrl ||
        !artRef.current ||
        !currentChannel
      ) {
        return;
      }

      // 銷燬之前的播放器實例並創建新的
      if (artPlayerRef.current) {
        cleanupPlayer();
      }

      // precheck type
      let type = 'm3u8';
      const liveProxyParams = new URLSearchParams({
        url: videoUrl,
        'moontv-source': currentSourceRef.current?.key || '',
      });
      const precheckUrl = `/api/live/precheck?${liveProxyParams.toString()}`;
      const precheckResponse = await fetch(precheckUrl);
      if (!precheckResponse.ok) {
        console.error('預檢查失敗:', precheckResponse.statusText);
        return;
      }
      const precheckResult = await precheckResponse.json();
      if (precheckResult.success) {
        type = precheckResult.type;
      }

      // 如果不是 m3u8 類型，設定不支持的類型並返回
      if (type !== 'm3u8') {
        setUnsupportedType(type);
        setIsVideoLoading(false);
        return;
      }

      // 重置不支持的類型
      setUnsupportedType(null);

      const customType = { m3u8: m3u8Loader };
      const targetUrl = `/api/proxy/m3u8?${liveProxyParams.toString()}`;
      try {
        // 創建新的播放器實例
        Artplayer.USE_RAF = false;
        Artplayer.FULLSCREEN_WEB_IN_BODY = true;

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: targetUrl,
          poster: currentChannel.logo,
          volume: 0.7,
          isLive: true, // 設定為直播模式
          muted: false,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: false,
          setting: false,
          loop: false,
          flip: false,
          playbackRate: false,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: true,
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: '#ff3e6c',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: false, // 直播不需要快進
          autoOrientation: true,
          lock: true,
          moreVideoAttr: {
            crossOrigin: 'anonymous',
            preload: 'metadata',
          },
          type: type,
          customType: customType,
          icons: {
            loading:
              '<img aria-hidden="true" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
        });

        // 監聽播放器事件
        artPlayerRef.current.on('ready', () => {
          setError(null);
          setIsVideoLoading(false);
        });

        artPlayerRef.current.on('loadstart', () => {
          setIsVideoLoading(true);
        });

        artPlayerRef.current.on('loadeddata', () => {
          setIsVideoLoading(false);
        });

        artPlayerRef.current.on('canplay', () => {
          setIsVideoLoading(false);
        });

        artPlayerRef.current.on('waiting', () => {
          setIsVideoLoading(true);
        });

        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器錯誤:', err);
        });

        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            targetUrl
          );
        }
      } catch (err) {
        console.error('創建播放器失敗:', err);
        // 不設定錯誤，只記錄日誌
      }
    };
    preload();
  }, [Artplayer, Hls, videoUrl, currentChannel, loading]);

  // 清理播放器資源
  useEffect(() => {
    return () => {
      cleanupPlayer();
    };
  }, []);

  // 頁面解除安裝時的額外清理
  useEffect(() => {
    const handleBeforeUnload = () => {
      cleanupPlayer();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupPlayer();
    };
  }, []);

  // 全局快捷鍵處理
  useEffect(() => {
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      // 忽略輸入框中的按鍵事件
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA'
      )
        return;

      // 上箭頭 = 音量+
      if (e.key === 'ArrowUp') {
        if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100
          )}`;
          e.preventDefault();
        }
      }

      // 下箭頭 = 音量-
      if (e.key === 'ArrowDown') {
        if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100
          )}`;
          e.preventDefault();
        }
      }

      // 空格 = 播放/暫停
      if (e.key === ' ') {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
          e.preventDefault();
        }
      }

      // f 鍵 = 切換全屏
      if (e.key === 'f' || e.key === 'F') {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 動畫直播圖標 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>📺</div>
                {/* 旋轉光環 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮動粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-accent rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-red-300 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 進度指示器 */}
            <div className='mb-6 w-64 sm:w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'loading'
                      ? 'bg-accent scale-125'
                      : 'bg-accent'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'fetching'
                      ? 'bg-accent scale-125'
                      : 'bg-accent'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'ready'
                      ? 'bg-accent scale-125'
                      : 'bg-zinc-300'
                  }`}
                ></div>
              </div>

              {/* 進度條 */}
              <div className='w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-accent to-[#cc3256] rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'loading'
                        ? '33%'
                        : loadingStage === 'fetching'
                          ? '66%'
                          : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加載消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-zinc-800 dark:text-zinc-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 錯誤圖標 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脈衝效果 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>
            </div>

            {/* 錯誤資訊 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-zinc-800 dark:text-zinc-200'>
                哎呀，出現了一些問題
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-zinc-500 dark:text-zinc-400'>
                請檢查網路連接或嘗試重新整理頁面
              </p>
            </div>

            {/* 操作按鈕 */}
            <div className='space-y-3'>
              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gradient-to-r from-accent to-[#cc3256] text-white rounded-xl font-medium hover:from-[#cc3256] hover:to-[#8a0510] transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                🔄 重新嘗試
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/live'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：頁面標題 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 max-w-[80%]'>
            <Radio className='w-5 h-5 text-accent flex-shrink-0' />
            <div className='min-w-0 flex-1'>
              <div className='truncate'>
                {currentSource?.name}
                {currentSource && currentChannel && (
                  <span className='text-zinc-500 dark:text-zinc-400'>
                    {` > ${currentChannel.name}`}
                  </span>
                )}
                {currentSource && !currentChannel && (
                  <span className='text-zinc-500 dark:text-zinc-400'>
                    {` > ${currentSource.name}`}
                  </span>
                )}
              </div>
            </div>
          </h1>
        </div>

        {/* 第二行：播放器和頻道列表 */}
        <div className='space-y-2'>
          {/* 摺疊控製 - 僅在 lg 及以上熒幕顯示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() => setIsChannelListCollapsed(!isChannelListCollapsed)}
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-zinc-800/80 dark:hover:bg-zinc-800 backdrop-blur-sm border border-zinc-200/50 dark:border-zinc-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={isChannelListCollapsed ? '顯示頻道列表' : '隱藏頻道列表'}
            >
              <svg
                className={`w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 transition-transform duration-200 ${
                  isChannelListCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-zinc-600 dark:text-zinc-300'>
                {isChannelListCollapsed ? '顯示' : '隱藏'}
              </span>

              {/* 精緻的狀態指示點 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isChannelListCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-accent'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isChannelListCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out ${
                isChannelListCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30'
                ></div>

                {/* 不支持的直播類型提示 */}
                {unsupportedType && (
                  <div className='absolute inset-0 bg-black/90 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-[600] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>⚠️</div>
                          <div className='absolute -inset-2 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl opacity-20 animate-pulse'></div>
                        </div>
                      </div>
                      <div className='space-y-4'>
                        <h3 className='text-xl font-semibold text-white'>
                          暫不支持的直播流類型
                        </h3>
                        <div className='bg-orange-500/20 border border-orange-500/30 rounded-lg p-4'>
                          <p className='text-orange-300 font-medium'>
                            當前頻道直播流類型：
                            <span className='text-white font-bold'>
                              {unsupportedType.toUpperCase()}
                            </span>
                          </p>
                          <p className='text-sm text-orange-200 mt-2'>
                            目前僅支持 M3U8 格式的直播流
                          </p>
                        </div>
                        <p className='text-sm text-zinc-300'>請嘗試其他頻道</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 影片加載蒙層 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>📺</div>
                          <div className='absolute -inset-2 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl opacity-20 animate-spin'></div>
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          🔄 IPTV 加載中...
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 頻道列表 */}
            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isChannelListCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
                {/* 主要的 Tab 切換 */}
                <div className='flex mb-1 -mx-6 flex-shrink-0'>
                  <div
                    onClick={() => setActiveTab('channels')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${
                        activeTab === 'channels'
                          ? 'text-accent'
                          : 'text-zinc-400 hover:text-white bg-white/5 dark:bg-white/5 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-800/30 dark:hover:bg-zinc-800/30'
                      }
                    `.trim()}
                  >
                    頻道
                  </div>
                  <div
                    onClick={() => setActiveTab('sources')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${
                        activeTab === 'sources'
                          ? 'text-accent'
                          : 'text-zinc-400 hover:text-white bg-white/5 dark:bg-white/5 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-800/30 dark:hover:bg-zinc-800/30'
                      }
                    `.trim()}
                  >
                    直播源
                  </div>
                </div>

                {/* 頻道 Tab 內容 */}
                {activeTab === 'channels' && (
                  <>
                    {/* 分組標籤 */}
                    <div className='flex items-center gap-4 mb-4 border-b border-zinc-300 dark:border-zinc-700 -mx-6 px-6 flex-shrink-0'>
                      {/* 切換狀態提示 */}
                      {isSwitchingSource && (
                        <div className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400'>
                          <div className='w-2 h-2 bg-amber-500 rounded-full animate-pulse'></div>
                          切換直播源中...
                        </div>
                      )}

                      <div
                        className='flex-1 overflow-x-auto'
                        ref={groupContainerRef}
                      >
                        <div className='flex gap-4 min-w-max'>
                          {Object.keys(groupedChannels).map((group, index) => (
                            <button
                              key={group}
                              data-group={group}
                              ref={(el) => {
                                groupButtonRefs.current[index] = el;
                              }}
                              onClick={() => handleGroupChange(group)}
                              disabled={isSwitchingSource}
                              className={`w-20 relative py-2 text-sm font-medium transition-colors flex-shrink-0 text-center overflow-hidden
                                 ${
                                   isSwitchingSource
                                     ? 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed opacity-50'
                                     : selectedGroup === group
                                       ? 'text-accent font-semibold'
                                       : 'text-zinc-400 hover:text-white'
                                 }
                               `.trim()}
                            >
                              <div
                                className='px-1 overflow-hidden whitespace-nowrap'
                                title={group}
                              >
                                {group}
                              </div>
                              {selectedGroup === group &&
                                !isSwitchingSource && (
                                  <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-accent' />
                                )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 頻道列表 */}
                    <div
                      ref={channelListRef}
                      className='flex-1 overflow-y-auto space-y-2 pb-4'
                    >
                      {filteredChannels.length > 0 ? (
                        filteredChannels.map((channel) => {
                          const isActive = channel.id === currentChannel?.id;
                          return (
                            <button
                              key={channel.id}
                              data-channel-id={channel.id}
                              onClick={() => handleChannelChange(channel)}
                              disabled={isSwitchingSource}
                              className={`w-full p-3 rounded-lg text-left transition-all duration-200 ${
                                isSwitchingSource
                                  ? 'opacity-50 cursor-not-allowed'
                                  : isActive
                                    ? 'bg-accent/20 border border-accent/40 font-semibold text-accent'
                                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-700'
                              }`}
                            >
                              <div className='flex items-center gap-3'>
                                <div className='w-10 h-10 bg-zinc-300 dark:bg-zinc-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                                  {channel.logo ? (
                                    <img
                                      src={buildLiveLogoProxyUrl(
                                        channel.logo,
                                        currentSource?.key
                                      )}
                                      alt={channel.name}
                                      className='w-full h-full rounded object-contain'
                                      loading='lazy'
                                      referrerPolicy='no-referrer'
                                    />
                                  ) : (
                                    <Tv className='w-5 h-5 text-zinc-500' />
                                  )}
                                </div>
                                <div className='flex-1 min-w-0'>
                                  <div
                                    className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'
                                    title={channel.name}
                                  >
                                    {channel.name}
                                  </div>
                                  <div
                                    className='text-xs text-zinc-500 dark:text-zinc-400 mt-1'
                                    title={channel.group}
                                  >
                                    {channel.group}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4'>
                            <Tv className='w-8 h-8 text-zinc-400 dark:text-zinc-600' />
                          </div>
                          <p className='text-zinc-500 dark:text-zinc-400 font-medium'>
                            暫無可用頻道
                          </p>
                          <p className='text-sm text-zinc-400 dark:text-zinc-500 mt-1'>
                            請選擇其他直播源或稍後再試
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 直播源 Tab 內容 */}
                {activeTab === 'sources' && (
                  <div className='flex flex-col h-full mt-4'>
                    <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                      {liveSources.length > 0 ? (
                        liveSources.map((source) => {
                          const isCurrentSource =
                            source.key === currentSource?.key;
                          return (
                            <div
                              key={source.key}
                              onClick={() =>
                                !isCurrentSource && handleSourceChange(source)
                              }
                              className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                                ${
                                  isCurrentSource
                                    ? 'bg-accent/10 dark:bg-accent/20 border-accent/30 border'
                                    : 'hover:bg-zinc-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                                }`.trim()}
                            >
                              {/* 圖標 */}
                              <div className='w-12 h-12 bg-zinc-200 dark:bg-zinc-600 rounded-lg flex items-center justify-center flex-shrink-0'>
                                <Radio className='w-6 h-6 text-zinc-500' />
                              </div>

                              {/* 資訊 */}
                              <div className='flex-1 min-w-0'>
                                <div className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'>
                                  {source.name}
                                </div>
                                <div className='text-xs text-zinc-500 dark:text-zinc-400 mt-1'>
                                  {!source.channelNumber ||
                                  source.channelNumber === 0
                                    ? '-'
                                    : `${source.channelNumber} 個頻道`}
                                </div>
                              </div>

                              {/* 當前標識 */}
                              {isCurrentSource && (
                                <div className='absolute top-2 right-2 w-2 h-2 bg-accent rounded-full'></div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4'>
                            <Radio className='w-8 h-8 text-zinc-400 dark:text-zinc-600' />
                          </div>
                          <p className='text-zinc-500 dark:text-zinc-400 font-medium'>
                            暫無可用直播源
                          </p>
                          <p className='text-sm text-zinc-400 dark:text-zinc-500 mt-1'>
                            請檢查網路連接或聯繫管理員新增直播源
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 當前頻道資訊 */}
        {currentChannel && (
          <div className='pt-4'>
            <div className='flex flex-col lg:flex-row gap-4'>
              {/* 頻道圖標+名稱 - 在小熒幕上占100%，大熒幕占20% */}
              <div className='w-full flex-shrink-0'>
                <div className='flex items-center gap-4'>
                  <div className='w-20 h-20 bg-zinc-300 dark:bg-zinc-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                    {currentChannel.logo ? (
                      <img
                        src={buildLiveLogoProxyUrl(
                          currentChannel.logo,
                          currentSource?.key
                        )}
                        alt={currentChannel.name}
                        className='w-full h-full rounded object-contain'
                        loading='lazy'
                        referrerPolicy='no-referrer'
                      />
                    ) : (
                      <Tv className='w-10 h-10 text-zinc-500' />
                    )}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-3'>
                      <h3 className='text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate'>
                        {currentChannel.name}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite();
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title={favorited ? '取消收藏' : '收藏'}
                      >
                        <FavoriteIcon filled={favorited} />
                      </button>
                    </div>
                    <p className='text-sm text-zinc-500 dark:text-zinc-400 truncate'>
                      {currentSource?.name} {' > '} {currentChannel.group}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* EPG節目單 */}
            <EpgScrollableRow
              programs={epgData?.programs || []}
              currentTime={new Date()}
              isLoading={isEpgLoading}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// FavoriteIcon 組件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-6 w-6'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ff3e6c'
          stroke='#ff3e6c'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-6 w-6 stroke-[1] text-zinc-600 dark:text-zinc-300' />
  );
};

export default function LivePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <LivePageGuard />
    </Suspense>
  );
}

function LivePageGuard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const runtimeConfig = window.RUNTIME_CONFIG;
    setEnabled(!!runtimeConfig?.ENABLE_WEB_LIVE);
  }, []);

  if (enabled === null) {
    return <div>Loading...</div>;
  }

  if (!enabled) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex flex-col items-center justify-center min-h-[60vh] text-center px-4'>
          <Radio className='h-16 w-16 text-zinc-300 dark:text-zinc-600 mb-4' />
          <h2 className='text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2'>
            網頁直播未開啟
          </h2>
          <p className='text-zinc-500 dark:text-zinc-400 max-w-md'>
            當前站點未啟用網頁直播功能，請聯繫站點管理員開啟。
          </p>
        </div>
      </PageLayout>
    );
  }

  return <LivePageClient />;
}
