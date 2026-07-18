describe('server storage fallback behavior', () => {
  const originalStorageType = process.env.STORAGE_TYPE;
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalStorageType === undefined) delete process.env.STORAGE_TYPE;
    else process.env.STORAGE_TYPE = originalStorageType;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('rejects writes when a remote backend is missing required env', async () => {
    process.env.STORAGE_TYPE = 'redis';
    delete process.env.REDIS_URL;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.resetModules();

    const { db, StorageUnavailableError } =
      jest.requireActual<typeof import('./db.js')>('./db');

    await expect(
      db.saveFavorite('user', 'source', 'id', {
        source_name: 'Source',
        total_episodes: 1,
        title: 'Title',
        year: '2026',
        cover: '',
        save_time: 1,
        search_title: 'Title',
      })
    ).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(db.registerUser('user', 'password')).rejects.toThrow(
      'Missing required env: REDIS_URL'
    );
    await expect(db.addSearchHistory('user', 'query')).rejects.toBeInstanceOf(
      StorageUnavailableError
    );
    await expect(db.clearAllData()).rejects.toBeInstanceOf(
      StorageUnavailableError
    );

    await expect(db.getAllFavorites('user')).resolves.toEqual({});
  });

  it('keeps localstorage server-side no-op writes unchanged', async () => {
    process.env.STORAGE_TYPE = 'localstorage';
    jest.resetModules();

    const { db } = jest.requireActual<typeof import('./db.js')>('./db');

    await expect(
      db.saveFavorite('user', 'source', 'id', {
        source_name: 'Source',
        total_episodes: 1,
        title: 'Title',
        year: '2026',
        cover: '',
        save_time: 1,
        search_title: 'Title',
      })
    ).resolves.toBeUndefined();
    await expect(db.registerUser('user', 'password')).resolves.toBeUndefined();
  });
});
