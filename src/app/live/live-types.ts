// 直播頻道接口
export interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

// 直播源接口
export interface LiveSource {
  key: string;
  name: string;
  url: string; // m3u 地址
  ua?: string;
  epg?: string; // 節目單
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}
