import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  AutoNextCountdownOverlay,
  ShortcutsHelpPanel,
  SkipButton,
  VideoLoadingOverlay,
} from './player-ui';

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
    expect(screen.getByText('🔄 切換播放源...')).toBeInTheDocument();
  });

  it('初始化階段顯示加載訊息', () => {
    render(<VideoLoadingOverlay stage='initing' />);
    expect(screen.getByText('🔄 影片載入中...')).toBeInTheDocument();
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
