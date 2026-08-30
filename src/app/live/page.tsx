/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, @next/next/no-img-element */

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
import { logger } from '@/lib/logger';
import {
  getLiveHlsBufferConfig,
  HLS_APPEND_TIMEOUT_MS,
  HLS_LIVE_MAX_UNCHANGED_PLAYLIST_REFRESH,
  isMobileUserAgent,
} from '@/lib/play-page-utils';
import { useClientValue } from '@/hooks/useClientMount';

import EpgScrollableRow from '@/components/EpgScrollableRow';
import PageLayout from '@/components/PageLayout';
import PageLoading from '@/components/PageLoading';
import { useToast } from '@/components/ToastProvider';

import {
  HLS_LIVE_STALE_PLAYLIST_MESSAGE,
  isPlaylistUnchangedError,
  nextHlsFatalAction,
} from '@/app/play/hls-fatal';

import { cleanEpgData } from './live-epg-utils';
import { LiveChannel, LiveSource } from './live-types';
import { buildLiveLogoProxyUrl } from './live-url';
import {
  LiveChannelList,
  LiveLoadingView,
  LiveSourceList,
  LiveVideoLoadingOverlay,
  UnsupportedTypeOverlay,
} from './live-views';

// 擴展 HTMLVideoElement 類型以支援 hls 屬性
declare global {
  interface HTMLVideoElement {
    hls?: Hls;
  }
}

function LivePageClient() {
  // -----------------------------------------------------------------------------
  // 狀態變量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'loading' | 'fetching' | 'ready'
  >('fetching');
  const [loadingMessage, setLoadingMessage] = useState('正在取得直播源…');
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const { toast } = useToast();

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

  // EPG 資料載入狀態
  const [isEpgLoading, setIsEpgLoading] = useState(false);
  const channelsAbortRef = useRef<AbortController | null>(null);
  const channelsRequestIdRef = useRef(0);
  const epgAbortRef = useRef<AbortController | null>(null);
  const epgRequestIdRef = useRef(0);
  const sourceSwitchRequestIdRef = useRef(0);

  // 收藏狀態
  const [favorited, setFavorited] = useState(false);
  const favoritedRef = useRef(false);
  const currentChannelRef = useRef<LiveChannel | null>(null);

  // EPG資料清洗函數 - 去除重疊的節目，保留時間較短的，只顯示今日節目
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

  const fetchEpg = async (channel: LiveChannel, source: LiveSource) => {
    const requestId = ++epgRequestIdRef.current;
    epgAbortRef.current?.abort();
    epgAbortRef.current = null;
    setEpgData(null);

    if (!channel.tvgId) {
      setIsEpgLoading(false);
      return;
    }

    const controller = new AbortController();
    epgAbortRef.current = controller;
    setIsEpgLoading(true);

    try {
      const epgParams = new URLSearchParams({
        source: source.key,
        tvgId: channel.tvgId,
      });
      const response = await fetch(`/api/live/epg?${epgParams.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`取得節目單資訊失敗: ${response.status}`);
      }

      const result = await response.json();
      if (requestId !== epgRequestIdRef.current) return;

      if (result.success) {
        setEpgData({
          ...result.data,
          programs: cleanEpgData(result.data.programs),
        });
      }
    } catch (err) {
      if (controller.signal.aborted || requestId !== epgRequestIdRef.current) {
        return;
      }
      console.error('取得節目單資訊失敗:', err);
    } finally {
      if (requestId === epgRequestIdRef.current) {
        if (epgAbortRef.current === controller) {
          epgAbortRef.current = null;
        }
        setIsEpgLoading(false);
      }
    }
  };

  // 取得直播源列表
  const fetchLiveSources = async () => {
    try {
      // 取得 AdminConfig 中的直播源資訊（loading 階段/訊息由初始 state 提供，
      // 避免在 effect 內同步 setState）
      const response = await fetch('/api/live/sources');
      if (!response.ok) {
        throw new Error('取得直播源失敗');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '取得直播源失敗');
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
      setLoadingMessage('準備就緒…');
      setLoading(false);
    } catch (err) {
      console.error('取得直播源失敗:', err);
      // 空列表與「載入失敗」畫面相同；必須明確提示，否則使用者會以為沒有直播源
      setLiveSources([]);
      setLoading(false);
      toast('取得直播源失敗，請稍後再試', 'error');
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

  // 取得頻道列表
  const fetchChannels = async (source: LiveSource) => {
    const requestId = ++channelsRequestIdRef.current;
    channelsAbortRef.current?.abort();
    const controller = new AbortController();
    channelsAbortRef.current = controller;

    ++epgRequestIdRef.current;
    epgAbortRef.current?.abort();
    epgAbortRef.current = null;
    setEpgData(null);
    setIsEpgLoading(false);
    setPlaybackError(null);
    setCurrentChannel(null);
    setVideoUrl('');
    setIsVideoLoading(true);

    try {
      // 從 cachedLiveChannels 取得頻道資訊
      const channelParams = new URLSearchParams({ source: source.key });
      const response = await fetch(
        `/api/live/channels?${channelParams.toString()}`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        throw new Error('取得頻道列表失敗');
      }

      const result = await response.json();
      if (requestId !== channelsRequestIdRef.current) return;
      if (!result.success) {
        throw new Error(result.error || '取得頻道列表失敗');
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

      // 預設選中深連結指定頻道，找不到時使用第一個頻道。
      const selectedChannel =
        (needLoadChannel
          ? channels.find((channel) => channel.id === needLoadChannel)
          : undefined) ?? channels[0];
      setCurrentChannel(selectedChannel);
      setVideoUrl(selectedChannel.url);
      void fetchEpg(selectedChannel, source);

      if (needLoadChannel && selectedChannel.id === needLoadChannel) {
        setTimeout(() => {
          if (requestId === channelsRequestIdRef.current) {
            scrollToChannel(selectedChannel);
          }
        }, 200);
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

      // 預設選中當前載入的channel所在的分組，如果沒有則選中第一個分組
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
          if (requestId !== channelsRequestIdRef.current) return;
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
    } catch (err) {
      if (
        controller.signal.aborted ||
        requestId !== channelsRequestIdRef.current
      ) {
        return;
      }
      console.error('取得頻道列表失敗:', err);
      setCurrentChannels([]);
      setGroupedChannels({});
      setFilteredChannels([]);
      toast('取得頻道列表失敗，請稍後再試或換一個直播源', 'error');

      // 更新直播源的頻道數為 0
      setLiveSources((prevSources) =>
        prevSources.map((s) =>
          s.key === source.key ? { ...s, channelNumber: 0 } : s
        )
      );
    } finally {
      if (requestId === channelsRequestIdRef.current) {
        if (channelsAbortRef.current === controller) {
          channelsAbortRef.current = null;
        }
        setIsVideoLoading(false);
      }
    }
  };

  // 切換直播源
  const handleSourceChange = async (source: LiveSource) => {
    const switchRequestId = ++sourceSwitchRequestIdRef.current;
    try {
      // 設定切換狀態，鎖住頻道切換器
      setIsSwitchingSource(true);

      // 首先銷燬當前播放器
      cleanupPlayer();

      // 重置不支援的類型狀態
      setUnsupportedType(null);

      // 清空節目單資訊
      setEpgData(null);

      setCurrentSource(source);
      await fetchChannels(source);
    } catch (err) {
      console.error('切換直播源失敗:', err);
      toast('切換直播源失敗，請稍後再試', 'error');
    } finally {
      if (switchRequestId === sourceSwitchRequestIdRef.current) {
        // 切換完成，解鎖頻道切換器
        setIsSwitchingSource(false);
        // 自動切換到頻道 tab
        setActiveTab('channels');
      }
    }
  };

  // 切換頻道
  const handleChannelChange = async (channel: LiveChannel) => {
    // 如果正在切換直播源，則禁用頻道切換
    if (isSwitchingSource) return;

    // 首先銷燬當前播放器
    cleanupPlayer();

    // 重置不支援的類型狀態
    setUnsupportedType(null);

    setCurrentChannel(channel);
    setVideoUrl(channel.url);

    // 自動滾動到選中的頻道位置
    setTimeout(() => {
      scrollToChannel(channel);
    }, 100);

    setPlaybackError(null);

    // 取得節目單資訊
    const sourceForEpg = currentSourceRef.current;
    if (sourceForEpg) {
      await fetchEpg(channel, sourceForEpg);
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
    // 重置不支援的類型狀態
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
            // 先停止載入
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
    // 掛載時抓取資料：setState 皆發生於 await 之後，規則對具名函式為保守誤判
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLiveSources();
  }, []);

  useEffect(() => {
    return () => {
      ++channelsRequestIdRef.current;
      ++epgRequestIdRef.current;
      ++sourceSwitchRequestIdRef.current;
      channelsAbortRef.current?.abort();
      epgAbortRef.current?.abort();
    };
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
      logger.error('HLS.js 未載入');
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

    const hlsBuffer = getLiveHlsBufferConfig(
      typeof navigator !== 'undefined' && isMobileUserAgent(navigator.userAgent)
    );
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      maxBufferLength: hlsBuffer.maxBufferLength,
      backBufferLength: hlsBuffer.backBufferLength,
      maxBufferSize: hlsBuffer.maxBufferSize,
      appendTimeout: HLS_APPEND_TIMEOUT_MS,
      liveMaxUnchangedPlaylistRefresh: HLS_LIVE_MAX_UNCHANGED_PLAYLIST_REFRESH,
      loader: CustomHlsJsLoader,
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    video.hls = hls;

    let networkRetries = 0;
    let mediaRetries = 0;
    hls.on(Hls.Events.ERROR, function (event: Events.ERROR, data: ErrorData) {
      if (video.hls !== hls) return;
      if (!data.fatal) {
        logger.debug('HLS Error:', event, data);
        return;
      }
      if (isPlaylistUnchangedError(data.details)) {
        logger.warn('直播頻道播放清單停止更新');
        hls.destroy();
        setIsVideoLoading(false);
        setPlaybackError(HLS_LIVE_STALE_PLAYLIST_MESSAGE);
        return;
      }

      const { action, nextNetworkRetries, nextMediaRetries } =
        nextHlsFatalAction(
          data.type,
          networkRetries,
          mediaRetries,
          '直播串流播放失敗，請嘗試其他頻道'
        );
      networkRetries = nextNetworkRetries;
      mediaRetries = nextMediaRetries;

      if (action.type === 'startLoad') {
        try {
          hls.startLoad();
        } catch (err) {
          logger.error('HLS 網路錯誤恢復失敗:', err);
          setIsVideoLoading(false);
          setPlaybackError('直播串流網路錯誤，請嘗試其他頻道');
        }
        return;
      }
      if (action.type === 'recoverMedia') {
        try {
          hls.recoverMediaError();
        } catch (err) {
          logger.error('HLS 媒體錯誤恢復失敗:', err);
          setIsVideoLoading(false);
          setPlaybackError('直播串流播放失敗，請嘗試其他頻道');
        }
        return;
      }
      if (action.type === 'swapAudioCodec') {
        try {
          hls.swapAudioCodec();
          hls.recoverMediaError();
        } catch (err) {
          logger.error('HLS 音訊編碼切換失敗:', err);
          setIsVideoLoading(false);
          setPlaybackError('直播串流播放失敗，請嘗試其他頻道');
        }
        return;
      }

      hls.destroy();
      setIsVideoLoading(false);
      setPlaybackError(action.message);
    });
  }

  // 播放器初始化
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

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

      try {
        setPlaybackError(null);
        // precheck type
        let type = 'm3u8';
        const liveProxyParams = new URLSearchParams({
          url: videoUrl,
          'moontv-source': currentSourceRef.current?.key || '',
        });
        const precheckUrl = `/api/live/precheck?${liveProxyParams.toString()}`;
        const precheckResponse = await fetch(precheckUrl, {
          signal: controller.signal,
        });
        if (!precheckResponse.ok) {
          throw new Error(`預檢查失敗: ${precheckResponse.status}`);
        }
        const precheckResult = await precheckResponse.json();
        if (cancelled) return;
        if (precheckResult.success) {
          type = precheckResult.type;
        }

        // 如果不是 m3u8 類型，設定不支援的類型並返回
        if (type !== 'm3u8') {
          setUnsupportedType(type);
          setIsVideoLoading(false);
          return;
        }

        // 重置不支援的類型
        setUnsupportedType(null);

        const customType = { m3u8: m3u8Loader };
        const targetUrl = `/api/proxy/m3u8?${liveProxyParams.toString()}`;
        if (cancelled) return;

        // 銷燬之前的播放器實例並創建新的。只有目前預檢仍有效時才切換，
        // 避免較慢的舊頻道請求覆蓋使用者後來選擇的頻道。
        if (artPlayerRef.current) {
          cleanupPlayer();
        }

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
          lang: 'zh-tw',
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
          if (cancelled) return;
          setPlaybackError(null);
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
          if (!cancelled) {
            setIsVideoLoading(false);
            setPlaybackError('直播串流播放失敗，請嘗試其他頻道');
          }
        });

        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            targetUrl
          );
        }
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        console.error('創建播放器失敗:', err);
        setIsVideoLoading(false);
        setPlaybackError('直播源連線失敗，請檢查網路或嘗試其他頻道');
      }
    };
    void preload();
    return () => {
      cancelled = true;
      controller.abort();
    };
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
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      )
        return;

      // 放行瀏覽器／系統快捷鍵，避免 Ctrl+F 被下方的全螢幕切換吃掉
      if (e.ctrlKey || e.metaKey || e.altKey) return;

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
      <LiveLoadingView
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
      />
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

                {/* 不支援的直播類型提示 */}
                {unsupportedType && (
                  <UnsupportedTypeOverlay type={unsupportedType} />
                )}

                {/* 影片載入蒙層 */}
                {isVideoLoading && <LiveVideoLoadingOverlay />}

                {playbackError && !isVideoLoading && (
                  <div className='absolute inset-0 z-[550] flex items-center justify-center rounded-xl bg-black/85 px-6 text-center'>
                    <div>
                      <p className='text-lg font-semibold text-red-300'>
                        {playbackError}
                      </p>
                      <p className='mt-2 text-sm text-zinc-300'>
                        頻道與直播源列表仍可使用，請切換後重試
                      </p>
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
                    <LiveChannelList
                      listRef={channelListRef}
                      channels={filteredChannels}
                      currentChannel={currentChannel}
                      sourceKey={currentSource?.key}
                      isSwitchingSource={isSwitchingSource}
                      onChannelChange={handleChannelChange}
                    />
                  </>
                )}

                {/* 直播源 Tab 內容 */}
                {activeTab === 'sources' && (
                  <LiveSourceList
                    sources={liveSources}
                    currentSource={currentSource}
                    onSourceChange={handleSourceChange}
                  />
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
  const enabled = useClientValue<boolean | null>(
    () => !!window.RUNTIME_CONFIG?.ENABLE_WEB_LIVE,
    null
  );

  if (enabled === null) {
    return <div>Loading...</div>;
  }

  if (!enabled) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex flex-col items-center justify-center min-h-[60vh] text-center px-4'>
          <Radio className='h-16 w-16 text-zinc-300 dark:text-zinc-600 mb-4' />
          {/* 此畫面會取代整個直播頁，因此它就是該狀態下的頁面主標題 */}
          <h1 className='text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2'>
            網頁直播未開啟
          </h1>
          <p className='text-zinc-500 dark:text-zinc-400 max-w-md'>
            當前站點未啟用網頁直播功能，請聯繫站點管理員開啟。
          </p>
        </div>
      </PageLayout>
    );
  }

  return <LivePageClient />;
}
