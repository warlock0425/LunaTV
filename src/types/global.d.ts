export {};

declare global {
  interface Window {
    RUNTIME_CONFIG?: {
      STORAGE_TYPE?: string;
      DOUBAN_PROXY_TYPE?:
        | 'cmliussss-cdn-tencent'
        | 'cmliussss-cdn-ali'
        | 'custom'
        | 'direct'
        | 'cors-proxy-zwei'
        | 'cors-anywhere';
      DOUBAN_PROXY?: string;
      DOUBAN_IMAGE_PROXY_TYPE?:
        | 'server'
        | 'cmliussss-cdn-tencent'
        | 'cmliussss-cdn-ali'
        | 'custom'
        | 'direct'
        | 'img3';
      DOUBAN_IMAGE_PROXY?: string;
      DISABLE_YELLOW_FILTER?: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CUSTOM_CATEGORIES?: any;
      FLUID_SEARCH?: boolean;
      ENABLE_WEB_LIVE?: boolean;
    };

    // Safari WebKit 特有 API，play 頁面用 typeof 做特徵偵測。
    webkitConvertPointFromNodeToPage?: (...args: unknown[]) => unknown;
  }
}
