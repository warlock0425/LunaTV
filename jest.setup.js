import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';
import {
  ReadableStream,
  TransformStream,
  WritableStream,
} from 'node:stream/web';

Object.defineProperty(globalThis, 'TextDecoder', {
  configurable: true,
  value: TextDecoder,
});
Object.defineProperty(globalThis, 'TextEncoder', {
  configurable: true,
  value: TextEncoder,
});
Object.defineProperty(globalThis, 'ReadableStream', {
  configurable: true,
  value: ReadableStream,
});
Object.defineProperty(globalThis, 'TransformStream', {
  configurable: true,
  value: TransformStream,
});
Object.defineProperty(globalThis, 'WritableStream', {
  configurable: true,
  value: WritableStream,
});
// React scheduler 只需要 postMessage/onmessage。Node 的原生 MessageChannel
// 會留下 worker_threads handle，讓 Jest 在測試完成後無法退出。
class TestMessageChannel {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = {
      postMessage: (data) => {
        setTimeout(() => this.port1.onmessage?.({ data }), 0);
      },
    };
  }
}
Object.defineProperty(globalThis, 'MessageChannel', {
  configurable: true,
  value: TestMessageChannel,
});
// undici (via url-safety) expects MessagePort in jsdom environments.
if (typeof globalThis.MessagePort === 'undefined') {
  Object.defineProperty(globalThis, 'MessagePort', {
    configurable: true,
    value: function MessagePort() {},
  });
}

// Allow router mocks.
// eslint-disable-next-line no-undef
jest.mock('next/router', () => require('next-router-mock'));

// 註：此處原本把 switch-chinese 整個 mock 掉，且 mock 只處理兩個寫死字串、
// 其餘一律原樣返回。那讓約 90 條涉及繁簡轉換的測試即使在轉換完全失效時仍會
// 全綠——等於本專案最核心的「繁體搜到簡體片源」沒有測試保護。
//
// 該 mock 應是在 jest.config.js 補上 moduleNameMapper／transformIgnorePatterns
// 之前，為了繞過 switch-chinese 的 ESM 解析問題而加的權宜措施；那些設定到位後
// 已無必要。移除後全套測試（552 條）通過，執行時間不變。
//
// 若日後真的需要在個別測試中固定轉換結果，請在該測試檔內局部 jest.mock，
// 不要再放回全域，以免又把整層保護關掉。

// Polyfill USERNAME env var for Linux/CI environments
process.env.USERNAME = process.env.USERNAME || 'admin';
