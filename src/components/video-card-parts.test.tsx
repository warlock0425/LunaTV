import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  AggregateSourcesIndicator,
  CardDoubanBadge,
  CardGlassPanel,
} from './video-card-parts';

describe('CardGlassPanel', () => {
  it('顯示標題與全集數標籤', () => {
    render(
      <CardGlassPanel
        title='進擊的巨人'
        episodes={25}
        showSourceName={false}
        displaySourceName=''
        origin='vod'
        showProgress={false}
      />
    );
    expect(screen.getAllByText('進擊的巨人').length).toBeGreaterThan(0);
    expect(screen.getByText('全 25 集')).toBeInTheDocument();
  });

  it('有目前集數時顯示進度式集數標籤', () => {
    render(
      <CardGlassPanel
        title='t'
        episodes={12}
        currentEpisode={3}
        showSourceName={false}
        displaySourceName=''
        origin='vod'
        showProgress={false}
      />
    );
    expect(screen.getByText('第 3/12 集')).toBeInTheDocument();
  });

  it('單集不顯示集數標籤、可顯示片源名稱', () => {
    render(
      <CardGlassPanel
        title='t'
        episodes={1}
        showSourceName
        displaySourceName='測試資源'
        origin='vod'
        showProgress={false}
      />
    );
    expect(screen.queryByText(/集/)).not.toBeInTheDocument();
    expect(screen.getByText('測試資源')).toBeInTheDocument();
  });
});

describe('AggregateSourcesIndicator', () => {
  it('顯示去重後的來源數量', () => {
    render(
      <AggregateSourcesIndicator sourceNames={['甲', '乙', '甲', '丙']} />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('超過 6 個來源時顯示更多提示', () => {
    const names = ['一', '二', '三', '四', '五', '六', '七', '八'];
    render(<AggregateSourcesIndicator sourceNames={names} />);
    expect(screen.getByText('+2 播放源')).toBeInTheDocument();
  });
});

describe('CardDoubanBadge', () => {
  it('Bangumi 模式連到 bgm.tv', () => {
    const { container } = render(<CardDoubanBadge isBangumi doubanId={123} />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://bgm.tv/subject/123'
    );
  });

  it('豆瓣模式連到 movie.douban.com', () => {
    const { container } = render(
      <CardDoubanBadge isBangumi={false} doubanId={456} />
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://movie.douban.com/subject/456'
    );
  });
});
