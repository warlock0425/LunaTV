/** @jest-environment node */

import { fetchDoubanData } from '@/lib/douban';

import { GET as getCategories } from './categories/route';
import { GET as getRecommends } from './recommends/route';
import { GET as getDouban } from './route';

jest.mock('@/lib/config', () => ({ getCacheTime: jest.fn() }));
jest.mock('@/lib/douban', () => ({
  fetchDoubanData: jest.fn(),
  toSimplified: (value: string) => value,
}));

const mockedFetchDoubanData = jest.mocked(fetchDoubanData);

describe('Douban API parameter validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['abc', '1.5', '-1', '101'])(
    'rejects invalid pageSize %s',
    async (pageSize) => {
      const response = await getDouban(
        new Request(
          `http://localhost/api/douban?type=movie&tag=hot&pageSize=${pageSize}`
        )
      );

      expect(response.status).toBe(400);
      expect(mockedFetchDoubanData).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid category pagination', async () => {
    const response = await getCategories(
      new Request(
        'http://localhost/api/douban/categories?kind=movie&category=hot&type=all&limit=abc'
      )
    );

    expect(response.status).toBe(400);
    expect(mockedFetchDoubanData).not.toHaveBeenCalled();
  });

  it.each([
    'kind=anime&limit=20&start=0',
    'kind=movie&limit=NaN&start=0',
    'kind=tv&limit=20&start=10001',
  ])('rejects invalid recommend query %s', async (query) => {
    const response = await getRecommends(
      new Request(`http://localhost/api/douban/recommends?${query}`) as never
    );

    expect(response.status).toBe(400);
    expect(mockedFetchDoubanData).not.toHaveBeenCalled();
  });
});
