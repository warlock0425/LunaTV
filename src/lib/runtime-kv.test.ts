import {
  getRuntimeKv,
  setRuntimeKvForTests,
  withRuntimeKvBudget,
} from './runtime-kv';

describe('runtime kv', () => {
  afterEach(() => {
    setRuntimeKvForTests(undefined);
  });

  it('returns null when no shared client exists', () => {
    setRuntimeKvForTests(null);
    expect(getRuntimeKv()).toBeNull();
  });

  it('uses the injected client within the hydrate budget', async () => {
    const client = {
      hGetAll: jest.fn(async () => ({ a: '1' })),
      hSet: jest.fn(async () => undefined),
      hDel: jest.fn(async () => undefined),
      expire: jest.fn(async () => undefined),
      mGet: jest.fn(async () => ['x']),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => undefined),
    };
    setRuntimeKvForTests(client);

    const value = await withRuntimeKvBudget((kv) => kv.hGetAll('k'), {});
    expect(value).toEqual({ a: '1' });
  });
});
