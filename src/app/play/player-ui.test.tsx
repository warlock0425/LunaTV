import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  AutoNextCountdownOverlay,
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

  it('正常年份仍然顯示', () => {
    render(<VideoDetailsPanel {...baseProps} videoYear='2026' />);
    expect(screen.getByText('2026')).toBeInTheDocument();
  });
});

/**
 * 長簡介預設收合，避免把下方的選集操作區擠掉。
 * 截斷以「字元」計算——emoji 與 BMP 以外的罕用字佔兩個 UTF-16 碼元，
 * 用 slice 會把一個字劈成兩半、渲染出破字。
 */
describe('VideoDetailsPanel 簡介收合', () => {
  const baseProps = {
    videoTitle: '片名',
    videoYear: '2026',
    videoCover: '',
    videoDoubanId: 0,
    favorited: false,
    onToggleFavorite: jest.fn(),
  };

  const renderWithDesc = (desc: string) =>
    render(<VideoDetailsPanel {...baseProps} detail={{ desc } as never} />);

  it('短簡介完整顯示，不出現展開按鈕', () => {
    renderWithDesc('短短的一句簡介');

    expect(screen.getByText('短短的一句簡介')).toBeInTheDocument();
    expect(screen.queryByText('展開全部簡介')).not.toBeInTheDocument();
  });

  it('長簡介預設收合，點擊後展開、再點收合', () => {
    const desc = '劇'.repeat(200);
    renderWithDesc(desc);

    // 收合時顯示的是截斷版本（帶省略號），不是原文
    expect(screen.queryByText(desc)).not.toBeInTheDocument();
    expect(screen.getByText(`${'劇'.repeat(180)}…`)).toBeInTheDocument();

    fireEvent.click(screen.getByText('展開全部簡介'));
    expect(screen.getByText(desc)).toBeInTheDocument();

    fireEvent.click(screen.getByText('收合簡介'));
    expect(screen.queryByText(desc)).not.toBeInTheDocument();
  });

  it('含 emoji 的長簡介不會被截成破字', () => {
    // 每個 🎬 佔兩個 UTF-16 碼元；用 slice(0,180) 會剛好切在代理對中間
    const desc = '🎬'.repeat(200);
    renderWithDesc(desc);

    const shown = screen.getByText(/🎬/).textContent || '';

    // Array.from 以「碼點」迭代：合法代理對會併成一個元素，只有落單的代理
    // 字元才會單獨出現在 U+D800–U+DFFF 區間。
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
