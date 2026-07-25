'use client';

import { Clapperboard, Link, Radio } from 'lucide-react';

/** 禁用選取/長按預設行為的共用樣式（卡片內大量元素使用） */
export const NO_SELECT_STYLE: React.CSSProperties = {
  WebkitUserSelect: 'none',
  userSelect: 'none',
  WebkitTouchCallout: 'none',
};

/** 阻止右鍵/長按預設選單 */
export const stopContextMenu = (e: React.SyntheticEvent) => {
  e.preventDefault();
  return false;
};

/** 豆瓣 / Bangumi 詳情連結徽章（hover 顯示於卡片左上） */
export function CardDoubanBadge({
  isBangumi,
  doubanId,
}: {
  isBangumi: boolean;
  doubanId: number;
}) {
  return (
    <a
      href={
        isBangumi
          ? `https://bgm.tv/subject/${doubanId.toString()}`
          : `https://movie.douban.com/subject/${doubanId.toString()}`
      }
      target='_blank'
      rel='noopener noreferrer'
      onClick={(e) => e.stopPropagation()}
      // 此徽章只能靠 hover 顯現，觸控裝置永遠觸發不到；原本在手機上是
      // 「看不見但仍可點、也仍會被鍵盤 focus」的隱形連結，誤觸就會跳出站外。
      // 因此 sm 以下直接不渲染，並讓鍵盤 focus 時也能顯現。
      className='absolute top-2 left-2 hidden -translate-x-2 opacity-0 transition-all duration-300 ease-in-out delay-100 focus-visible:opacity-100 focus-visible:translate-x-0 sm:block sm:group-hover:opacity-100 sm:group-hover:translate-x-0'
      style={NO_SELECT_STYLE}
      onContextMenu={stopContextMenu}
    >
      <div
        className='bg-accent text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-accent-deep hover:scale-[1.1] transition-all duration-300 ease-out'
        style={NO_SELECT_STYLE}
        onContextMenu={stopContextMenu}
      >
        <Link size={16} style={{ ...NO_SELECT_STYLE, pointerEvents: 'none' }} />
      </div>
    </a>
  );
}

// 優先顯示的播放源（常見的主流平臺）
const PRIORITY_SOURCES = [
  '愛奇藝',
  '騰訊影片',
  '優酷',
  '芒果TV',
  '嗶哩嗶哩',
  'Netflix',
  'Disney+',
];

/** 聚合播放源指示器：右下角來源數徽章 + hover 顯示來源清單 */
export function AggregateSourcesIndicator({
  sourceNames,
}: {
  sourceNames: string[];
}) {
  const uniqueSources = Array.from(new Set(sourceNames));
  const sourceCount = uniqueSources.length;

  // 按優先級排序播放源
  const sortedSources = uniqueSources.sort((a, b) => {
    const aIndex = PRIORITY_SOURCES.indexOf(a);
    const bIndex = PRIORITY_SOURCES.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });

  const maxDisplayCount = 6; // 最多顯示6個
  const displaySources = sortedSources.slice(0, maxDisplayCount);
  const hasMore = sortedSources.length > maxDisplayCount;
  const remainingCount = sortedSources.length - maxDisplayCount;

  return (
    <div
      className='absolute bottom-2 right-2 transition-all duration-300 ease-in-out delay-75 z-[60]'
      style={NO_SELECT_STYLE}
      onContextMenu={stopContextMenu}
    >
      <div className='relative group/sources' style={NO_SELECT_STYLE}>
        <div
          className='bg-accent/90 backdrop-blur-sm border border-white/20 text-white text-xs font-bold w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shadow-lg hover:bg-accent hover:scale-[1.1] transition-all duration-300 ease-out cursor-pointer'
          style={NO_SELECT_STYLE}
          onContextMenu={stopContextMenu}
        >
          {sourceCount}
        </div>

        {/* 播放源詳情懸浮框 */}
        <div
          className='absolute bottom-full mb-2 opacity-0 invisible group-hover/sources:opacity-100 group-hover/sources:visible transition-all duration-200 ease-out delay-100 pointer-events-none z-50 right-0 sm:right-0 -translate-x-0 sm:translate-x-0'
          style={NO_SELECT_STYLE}
          onContextMenu={stopContextMenu}
        >
          <div
            className='bg-zinc-900/95 backdrop-blur-sm text-white text-xs sm:text-xs rounded-lg shadow-xl border border-white/15 p-1.5 sm:p-2 min-w-[100px] sm:min-w-[120px] max-w-[140px] sm:max-w-[200px] overflow-hidden'
            style={NO_SELECT_STYLE}
            onContextMenu={stopContextMenu}
          >
            {/* 單列佈局 */}
            <div className='space-y-0.5 sm:space-y-1'>
              {displaySources.map((sourceName, index) => (
                <div key={index} className='flex items-center gap-1 sm:gap-1.5'>
                  <div className='w-0.5 h-0.5 sm:w-1 sm:h-1 bg-blue-400 rounded-full flex-shrink-0'></div>
                  <span
                    className='truncate text-[11px] sm:text-xs font-medium leading-tight text-zinc-200'
                    title={sourceName}
                  >
                    {sourceName}
                  </span>
                </div>
              ))}
            </div>

            {/* 顯示更多提示 */}
            {hasMore && (
              <div className='mt-1 sm:mt-2 pt-1 sm:pt-1.5 border-t border-zinc-700/50'>
                <div className='flex items-center justify-center text-zinc-400'>
                  <span className='text-[11px] sm:text-xs font-medium text-zinc-300'>
                    +{remainingCount} 播放源
                  </span>
                </div>
              </div>
            )}

            {/* 小箭頭 */}
            <div className='absolute top-full right-2 sm:right-3 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px] border-transparent border-t-zinc-800/90'></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 卡片底部資訊面板：標題（含 tooltip）、集數/片源標籤、播放進度條 */
export function CardGlassPanel({
  title,
  episodes,
  currentEpisode,
  showSourceName,
  displaySourceName,
  origin,
  showProgress,
  progress,
}: {
  title: string;
  episodes?: number;
  currentEpisode?: number;
  showSourceName: boolean;
  displaySourceName: string;
  origin: 'vod' | 'live';
  showProgress: boolean;
  progress?: number;
}) {
  return (
    <div
      className='absolute inset-x-0 bottom-0 flex flex-col justify-end pointer-events-none'
      style={{
        background: 'transparent',
        paddingTop: '2rem',
        ...NO_SELECT_STYLE,
      }}
      onContextMenu={stopContextMenu}
    >
      <div
        className='w-full bg-gradient-to-t from-black via-black/80 to-transparent pt-6 pb-2 px-2.5 flex flex-col gap-1 pointer-events-auto'
        style={NO_SELECT_STYLE}
        onContextMenu={stopContextMenu}
      >
        {/* 標題 */}
        <div className='relative' style={NO_SELECT_STYLE}>
          <span
            className='block text-sm font-bold truncate text-white transition-colors duration-300 ease-in-out group-hover:text-white peer drop-shadow-md tracking-wide'
            style={NO_SELECT_STYLE}
            onContextMenu={stopContextMenu}
          >
            {title}
          </span>
          {/* 自定義 tooltip */}
          <div
            className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-zinc-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[600] pointer-events-none'
            style={NO_SELECT_STYLE}
            onContextMenu={stopContextMenu}
          >
            {title}
            <div
              className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-zinc-800'
              style={NO_SELECT_STYLE}
            ></div>
          </div>
        </div>

        {/* 標籤區塊 (集數 + 片源) */}
        <div
          className='flex items-center gap-1.5 overflow-hidden w-full'
          style={NO_SELECT_STYLE}
          onContextMenu={stopContextMenu}
        >
          {episodes && episodes > 1 && (
            <span
              className='shrink-0 rounded-full bg-zinc-800 text-white px-2 py-0.5 text-[10px] font-medium tracking-wide'
              style={NO_SELECT_STYLE}
              onContextMenu={stopContextMenu}
            >
              {currentEpisode
                ? `第 ${currentEpisode}/${episodes} 集`
                : `全 ${episodes} 集`}
            </span>
          )}
          {showSourceName && displaySourceName && (
            <span
              title={displaySourceName}
              className='truncate text-[10px] font-medium text-white bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-sm tracking-wide inline-flex items-center gap-1 shrink-1'
              style={NO_SELECT_STYLE}
              onContextMenu={stopContextMenu}
            >
              {origin === 'live' ? (
                <Radio size={10} className='shrink-0 text-white opacity-80' />
              ) : (
                <Clapperboard
                  size={10}
                  className='shrink-0 text-white opacity-80'
                />
              )}
              {displaySourceName}
            </span>
          )}
        </div>
      </div>

      {/* 進度條 (直接貼在最底部) */}
      {showProgress && progress !== undefined && (
        <div
          className='h-0.5 w-full bg-zinc-800 overflow-hidden relative z-[50] pointer-events-none'
          style={NO_SELECT_STYLE}
          onContextMenu={stopContextMenu}
        >
          <div
            className='h-full bg-accent transition-all duration-500 ease-out'
            style={{ width: `${progress}%`, ...NO_SELECT_STYLE }}
            onContextMenu={stopContextMenu}
          />
        </div>
      )}
    </div>
  );
}
