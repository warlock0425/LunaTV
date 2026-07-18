/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getCachedLiveChannels } from '@/lib/live';

import { GET } from './route';

jest.mock('@/lib/live', () => ({ getCachedLiveChannels: jest.fn() }));

const mockedGetCachedLiveChannels = jest.mocked(getCachedLiveChannels);

describe('/api/live/epg', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when the source does not exist or is disabled', async () => {
    mockedGetCachedLiveChannels.mockResolvedValue(null);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/live/epg?source=missing&tvgId=channel-1'
      )
    );

    expect(response.status).toBe(404);
  });
});
