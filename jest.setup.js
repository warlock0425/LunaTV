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

jest.mock('switch-chinese', () => {
  return jest.fn().mockImplementation(() => ({
    traditionalized: (text) =>
      text
        .replace(/关于我转生变成史莱姆这档事/g, '關於我轉生變成史萊姆這檔事')
        .replace(/苍海之泪篇/g, '蒼海之淚篇'),
    simplized: (text) =>
      text
        .replace(/關於我轉生變成史萊姆這檔事/g, '关于我转生变成史莱姆这档事')
        .replace(/蒼海之淚篇/g, '苍海之泪篇'),
  }));
});

// Polyfill USERNAME env var for Linux/CI environments
process.env.USERNAME = process.env.USERNAME || 'admin';
