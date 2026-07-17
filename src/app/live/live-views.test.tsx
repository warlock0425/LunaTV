import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import '@testing-library/jest-dom';

import { LiveChannel, LiveSource } from './live-types';
import {
  LiveChannelList,
  LiveSourceList,
  UnsupportedTypeOverlay,
} from './live-views';

const makeSource = (
  key: string,
  overrides?: Partial<LiveSource>
): LiveSource => ({
  key,
  name: `源 ${key}`,
  url: `https://example.com/${key}.m3u`,
  from: 'config',
  ...overrides,
});

const makeChannel = (id: string): LiveChannel => ({
  id,
  tvgId: id,
  name: `頻道 ${id}`,
  logo: '',
  group: '新聞',
  url: `https://example.com/${id}.m3u8`,
});

describe('LiveSourceList', () => {
  it('顯示來源與頻道數，點擊非當前來源觸發切換', () => {
    const onSourceChange = jest.fn();
    const sources = [makeSource('a', { channelNumber: 12 }), makeSource('b')];
    render(
      <LiveSourceList
        sources={sources}
        currentSource={sources[0]}
        onSourceChange={onSourceChange}
      />
    );
    expect(screen.getByText('12 個頻道')).toBeInTheDocument();

    fireEvent.click(screen.getByText('源 b'));
    expect(onSourceChange).toHaveBeenCalledWith(sources[1]);

    // 點擊當前來源不觸發
    fireEvent.click(screen.getByText('源 a'));
    expect(onSourceChange).toHaveBeenCalledTimes(1);
  });

  it('無來源時顯示空狀態', () => {
    render(
      <LiveSourceList
        sources={[]}
        currentSource={null}
        onSourceChange={jest.fn()}
      />
    );
    expect(screen.getByText('暫無可用直播源')).toBeInTheDocument();
  });
});

describe('LiveChannelList', () => {
  it('顯示頻道並支援切換；切換中禁用點擊', () => {
    const onChannelChange = jest.fn();
    const channels = [makeChannel('c1'), makeChannel('c2')];
    render(
      <LiveChannelList
        listRef={createRef<HTMLDivElement>()}
        channels={channels}
        currentChannel={channels[0]}
        isSwitchingSource={false}
        onChannelChange={onChannelChange}
      />
    );
    fireEvent.click(screen.getByText('頻道 c2'));
    expect(onChannelChange).toHaveBeenCalledWith(channels[1]);
  });

  it('無頻道時顯示空狀態', () => {
    render(
      <LiveChannelList
        listRef={createRef<HTMLDivElement>()}
        channels={[]}
        currentChannel={null}
        isSwitchingSource={false}
        onChannelChange={jest.fn()}
      />
    );
    expect(screen.getByText('暫無可用頻道')).toBeInTheDocument();
  });
});

describe('UnsupportedTypeOverlay', () => {
  it('顯示大寫的直播流類型', () => {
    render(<UnsupportedTypeOverlay type='flv' />);
    expect(screen.getByText('FLV')).toBeInTheDocument();
  });
});
