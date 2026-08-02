import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  AutoNextCountdownOverlay,
  PlaybackSoftErrorOverlay,
  PlayerEpisodeBadge,
  ShortcutsHelpPanel,
  SkipButton,
  VideoDetailsPanel,
  VideoLoadingOverlay,
} from './player-ui';

describe('VideoDetailsPanel 年份顯示', () => {
  const baseProps = {
    detail: null,
    videoTitle: '轉學後班上的清純可愛美少女',
    videoCover: '',
    videoDoubanId: 0,
    favorited: false,
    onToggleFavorite: jest.fn(),
  };

  // downstream 抓不到年份時填的是字串 'unknown'，非空字串會通過 truthy 檢查
  it('不把 unknown 哨兵值顯示給使用者', () => {
    render(<VideoDetailsPanel {...baseProps} videoYear='unknown' />);
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
  });

  it('正常年份在精簡列仍然顯示（不必展開）', () => {
    render(<VideoDetailsPanel {...baseProps} videoYear='2026' />);
    expect(screen.getByText('2026')).toBeInTheDocument();
  });
});

/**
 * 面板預設收合，避免與頂部標題重複佔高。
 * 長簡介在展開面板後仍以「字元」截斷（避免 emoji 破字）。
 */
describe('VideoDetailsPanel 面板與簡介收合', () => {
  const baseProps = {
    videoTitle: '片名',
    videoYear: '2026',
    videoCover: '',
    videoDoubanId: 0,
    favorited: false,
    onToggleFavorite: jest.fn(),
  };

  const openPanel = () => {
    fireEvent.click(screen.getByRole('button', { name: /影片資訊/ }));
  };

  const renderWithDesc = (desc: string) =>
    render(<VideoDetailsPanel {...baseProps} detail={{ desc } as never} />);

  it('預設收合時看不到簡介，展開後才出現', () => {
    renderWithDesc('短短的一句簡介');
    expect(screen.queryByText('短短的一句簡介')).not.toBeInTheDocument();
    openPanel();
    expect(screen.getByText('短短的一句簡介')).toBeInTheDocument();
    expect(screen.queryByText('展開全部簡介')).not.toBeInTheDocument();
  });

  it('長簡介在面板內預設截斷，可再展開全文', () => {
    const desc = '劇'.repeat(200);
    renderWithDesc(desc);
    openPanel();

    expect(screen.queryByText(desc)).not.toBeInTheDocument();
    expect(screen.getByText(`${'劇'.repeat(180)}…`)).toBeInTheDocument();

    fireEvent.click(screen.getByText('展開全部簡介'));
    expect(screen.getByText(desc)).toBeInTheDocument();

    fireEvent.click(screen.getByText('收合簡介'));
    expect(screen.queryByText(desc)).not.toBeInTheDocument();
  });

  it('含 emoji 的長簡介不會被截成破字', () => {
    const desc = '🎬'.repeat(200);
    renderWithDesc(desc);
    openPanel();

    const shown = screen.getByText(/🎬/).textContent || '';
    const loneSurrogates = Array.from(shown).filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0xd800 && code <= 0xdfff;
    });

    expect(loneSurrogates).toEqual([]);
    expect(Array.from(shown.replace('…', ''))).toHaveLength(180);
  });
});

describe('SkipButton', () => {
  it('顯示標籤並可點擊', () => {
    const onClick = jest.fn();
    render(<SkipButton label='跳過片頭' onClick={onClick} />);
    fireEvent.click(screen.getByText('跳過片頭'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('VideoLoadingOverlay', () => {
  it('換源階段顯示切換訊息', () => {
    render(<VideoLoadingOverlay stage='sourceChanging' />);
    expect(screen.getByText('切換播放源…')).toBeInTheDocument();
  });

  it('初始化階段顯示加載訊息', () => {
    render(<VideoLoadingOverlay stage='initing' />);
    expect(screen.getByText('影片載入中…')).toBeInTheDocument();
  });
});

describe('PlaybackSoftErrorOverlay', () => {
  it('提供重試與換源', () => {
    const onRetry = jest.fn();
    const onSwitchSource = jest.fn();
    render(
      <PlaybackSoftErrorOverlay
        message='測試錯誤'
        onRetry={onRetry}
        onSwitchSource={onSwitchSource}
      />
    );
    expect(screen.getByText('測試錯誤')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重新整理播放'));
    fireEvent.click(screen.getByText('前往換源'));
    expect(onRetry).toHaveBeenCalled();
    expect(onSwitchSource).toHaveBeenCalled();
  });
});

describe('PlayerEpisodeBadge', () => {
  it('顯示集數標籤', () => {
    render(<PlayerEpisodeBadge label='第 4 集' />);
    expect(screen.getByText('第 4 集')).toBeInTheDocument();
  });
});

describe('AutoNextCountdownOverlay', () => {
  it('顯示倒數秒數並觸發按鈕回呼', () => {
    const onPlayNow = jest.fn();
    const onCancel = jest.fn();
    render(
      <AutoNextCountdownOverlay
        countdown={5}
        onPlayNow={onPlayNow}
        onCancel={onCancel}
      />
    );
    expect(screen.getByText('5')).toBeInTheDocument();
    fireEvent.click(screen.getByText('立即播放'));
    expect(onPlayNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ShortcutsHelpPanel', () => {
  it('列出快捷鍵並支援關閉', () => {
    const onClose = jest.fn();
    render(<ShortcutsHelpPanel onClose={onClose} />);
    expect(
      screen.getByRole('heading', { name: '快捷鍵幫助' })
    ).toBeInTheDocument();
    expect(screen.getByText('播放 / 暫停')).toBeInTheDocument();
    fireEvent.click(screen.getByText('關閉'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('點擊背景關閉、點擊面板本體不關閉', () => {
    const onClose = jest.fn();
    const { container } = render(<ShortcutsHelpPanel onClose={onClose} />);
    fireEvent.click(screen.getByRole('heading', { name: '快捷鍵幫助' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
