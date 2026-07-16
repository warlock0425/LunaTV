import { extractBangumiAliases, normalizeAliasList } from './bangumi-aliases';
import {
  deduplicatePlayRecordList,
  getPlayRecordKeysByIdentity,
  getPlayRecordKeysToReplace,
} from './play-records';
import {
  buildPlaybackSearchPlan,
  deduplicateResults,
  getBangumiTranslationFallbackQueries,
  getChineseAliasSourceSearchQueries,
  getFastSourceSearchQueries,
  getMainlandFallbackSourceSearchQueries,
  getMatchQueries,
  getSourceSearchQueries,
  getStrictCardMatchQueries,
  isBangumiTranslationFallbackMatch,
  isStrictCardTitleMatch,
  normalizeSearchTitleForSource,
  sortByTitleMatch,
} from './play-search';
import { SearchResult } from './types';

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: '1',
    title: '測試',
    poster: '',
    episodes: [],
    episodes_titles: [],
    source: 'source',
    source_name: '片源',
    year: '',
    ...overrides,
  };
}

describe('play-search helpers', () => {
  it('normalizes titles for mainland source search', () => {
    expect(normalizeSearchTitleForSource('尖帽子的魔法工房：第 2 季！')).toBe(
      '尖帽子的魔法工房第2季'
    );
    expect(normalizeSearchTitleForSource('進擊の巨人')).toBe('进击の巨人');
    expect(normalizeSearchTitleForSource('石紀元 科學與未來 第3期')).toBe(
      '石纪元科学与未来第3期'
    );
  });

  it('only sends Chinese titles and aliases to mainland sources', () => {
    expect(
      getSourceSearchQueries('尖帽子的魔法工房', 'とんがり帽子のアトリエ', [
        '尖帽子的魔法工坊',
      ])
    ).toEqual(['尖帽子的魔法工房', '尖帽子的魔法工坊']);
  });

  it('does not use short base aliases as Bangumi match queries', () => {
    const queries = getMatchQueries('石紀元 科學與未來 第3期', 'Dr.STONE', [
      '石紀元',
      '石紀元 科學與未來',
    ]);

    expect(queries).not.toContain('石纪元');
    expect(queries).toContain('石纪元科学与未来第3期');
    expect(queries).toContain('石纪元科学与未来');
  });

  it('uses exact title matching for Bangumi card playback', () => {
    const queries = getStrictCardMatchQueries(
      '石紀元 科學與未來 第3期',
      'Dr.STONE SCIENCE FUTURE',
      ['石紀元', '石紀元 科學與未來']
    );

    expect(isStrictCardTitleMatch('石紀元 科學與未來 第3期', queries)).toBe(
      true
    );
    expect(isStrictCardTitleMatch('石紀元第三季', queries)).toBe(false);
    expect(isStrictCardTitleMatch('石紀元4Part3', queries)).toBe(false);
  });

  it('deduplicates by source and id without merging different ids', () => {
    const list = [
      result({ source: 'a', id: '1', title: 'A1' }),
      result({ source: 'a', id: '1', title: 'A1 duplicate' }),
      result({ source: 'a', id: '2', title: 'A2' }),
    ];

    expect(deduplicateResults(list).map((item) => item.title)).toEqual([
      'A1',
      'A2',
    ]);
  });

  it('filters weak aliases and keeps insertion order', () => {
    expect(
      normalizeAliasList([
        '尖帽子的魔法工房',
        ' ',
        'https://example.com/poster.jpg',
        '尖帽子的魔法工房',
        '尖帽子的魔法工坊',
      ])
    ).toEqual(['尖帽子的魔法工房', '尖帽子的魔法工坊']);
  });

  it('sorts better title matches first', () => {
    const sorted = sortByTitleMatch(
      [
        result({ title: '尖帽子的魔法工房 外傳', id: 'side' }),
        result({ title: '尖帽子的魔法工房', id: 'main' }),
      ],
      ['尖帽子的魔法工房']
    );

    expect(sorted[0].id).toBe('main');
  });

  it('deduplicates search queries when convertT2S produces variants', () => {
    const queries = getSourceSearchQueries('進擊的巨人');
    expect(queries.length).toBeGreaterThan(0);
    const unique = new Set(queries);
    expect(queries.length).toBe(unique.size);
  });

  it('normalizes Chinese source queries without English fallback', () => {
    const queries = getSourceSearchQueries('進擊的巨人');
    expect(queries).toContain('进击的巨人');
    expect(queries).not.toContain('Attack on Titan');
  });

  it('extracts useful Bangumi aliases from subject details', () => {
    expect(
      extractBangumiAliases({
        name: 'Witch Hat Atelier',
        name_cn: '尖帽子的魔法工房',
        infobox: [
          { key: '別名', value: [{ v: '尖帽子的魔法工坊' }] },
          { key: '官方網站', value: 'https://example.com' },
        ],
      })
    ).toEqual(['尖帽子的魔法工房', 'Witch Hat Atelier', '尖帽子的魔法工坊']);
  });

  it('keeps play records from different direct source identities separate', () => {
    const records = deduplicatePlayRecordList([
      {
        key: 'a+1',
        title: '沒有辣妹會對阿宅溫柔!?',
        source: 'a',
        source_name: 'A 資源',
        save_time: 100,
      },
      {
        key: 'b+2',
        title: '沒有辣妹會對阿宅溫柔！？',
        source: 'b',
        source_name: 'B 資源',
        save_time: 200,
      },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0].key).toBe('b+2');
    expect(records[1].key).toBe('a+1');
    expect(
      getPlayRecordKeysByIdentity(
        [
          {
            key: 'a+1',
            title: '沒有辣妹會對阿宅溫柔!?',
            source: 'a',
            save_time: 100,
          },
          {
            key: 'b+2',
            title: '沒有辣妹會對阿宅溫柔！？',
            source: 'b',
            save_time: 200,
          },
        ],
        records[0]
      )
    ).toEqual(['b+2']);
  });

  it('replaces older play records for the same searched title across sources', () => {
    const records = {
      'a+1': {
        key: 'a+1',
        title: '進擊的巨人',
        search_title: '進擊的巨人',
        source: 'a',
        vod_id: '1',
        year: '2013',
        save_time: 100,
      },
      'b+2': {
        key: 'b+2',
        title: '進擊的巨人',
        search_title: '進擊的巨人',
        source: 'b',
        vod_id: '2',
        year: '2013',
        save_time: 200,
      },
      'c+3': {
        key: 'c+3',
        title: '進擊的巨人',
        search_title: '進擊的巨人',
        source: 'c',
        vod_id: '3',
        year: '2015',
        save_time: 300,
      },
    };

    expect(
      getPlayRecordKeysToReplace(records, {
        key: 'b+2',
        title: '进击的巨人',
        search_title: '进击的巨人',
        source: 'b',
        vod_id: '2',
        year: '2013',
        save_time: 400,
      })
    ).toEqual(['a+1', 'b+2']);
  });

  it('keeps fast source queries focused on title and search title', () => {
    expect(
      getFastSourceSearchQueries('尖帽子的魔法工房', 'Witch Hat Atelier')
    ).toEqual(['尖帽子的魔法工房']);
  });

  it('keeps traditional and simplified Chinese in fast source queries', () => {
    const queries = getFastSourceSearchQueries('進擊的巨人', 'Attack on Titan');
    expect(queries).toContain('進擊的巨人');
    expect(queries).toContain('进击的巨人');
    expect(queries).not.toContain('Attack on Titan');
  });

  it('uses core Chinese keywords before full long anime titles', () => {
    const queries = getFastSourceSearchQueries(
      '\u6700\u5f37\u7684\u8077\u696d\u4e0d\u662f\u52c7\u8005\u4e5f\u4e0d\u662f\u8ce2\u8005\u597d\u50cf\u662f\u9451\u5b9a\u58eb(\u50de)\u7684\u6a23\u5b50'
    );

    expect(queries[0]).toBe('\u9274\u5b9a\u58eb');
    expect(queries).toContain(
      '\u6700\u5f3a\u7684\u804c\u4e1a\u4e0d\u662f\u52c7\u8005\u4e5f\u4e0d\u662f\u8d24\u8005\u597d\u50cf\u662f\u9274\u5b9a\u58eb\u7684\u6837\u5b50'
    );
  });

  it('derives season-aware mainland core queries without title-specific aliases', () => {
    const queries = getFastSourceSearchQueries(
      '\u5be6\u969b\u77f3\u7d00\u5143\u7b2c\u56db\u5b63Prat3'
    );

    expect(queries).toContain('\u77f3\u7eaa\u51434Part3');
    expect(queries).toContain('\u77f3\u7eaa\u5143Part3');
    expect(
      getMainlandFallbackSourceSearchQueries(
        '\u5be6\u969b\u77f3\u7d00\u5143\u7b2c\u56db\u5b63Prat3'
      )
    ).not.toContain('\u65b0\u77f3\u7eaa4Part3');
  });

  it('keeps Bangumi aliases inside a single playback search plan', () => {
    expect(
      buildPlaybackSearchPlan({
        title: '\u5be6\u969b\u77f3\u7d00\u5143\u7b2c\u56db\u5b63Prat3',
        searchTitle: 'Dr.STONE SCIENCE FUTURE',
        isBangumiCardSearch: true,
      }).map((stage) => stage.reason)
    ).toEqual(['fast', 'mainland']);

    const withAliases = buildPlaybackSearchPlan({
      title: '\u5be6\u969b\u77f3\u7d00\u5143\u7b2c\u56db\u5b63Prat3',
      searchTitle: 'Dr.STONE SCIENCE FUTURE',
      aliases: ['\u65b0\u77f3\u7d00'],
      isBangumiCardSearch: true,
      includeFastStage: false,
    });

    expect(withAliases.map((stage) => stage.reason)).toEqual([
      'bangumi-alias',
      'search-title',
      'full',
      'translation-core',
    ]);
    expect(withAliases[0].queries).toContain('\u65b0\u77f3\u7eaa');
    expect(withAliases.every((stage) => stage.directSearch)).toBe(true);
  });

  it('recalls mainland translation variants through shared title fragments', () => {
    const queries = getBangumiTranslationFallbackQueries('吞噬魔物的冒險者');

    expect(queries).toContain('物的冒险者');
    expect(
      isBangumiTranslationFallbackMatch('吃魔物的冒險者', '物的冒險者', [
        '吞噬魔物的冒險者',
      ])
    ).toBe(true);
  });

  it('keeps both long and short cores inside the four-query budget', () => {
    const queries =
      getBangumiTranslationFallbackQueries('關於我轉生變成史萊姆這檔事');

    expect(queries).toHaveLength(4);
    expect(queries.some((query) => query.length === 5)).toBe(true);
    expect(queries.some((query) => query.length === 4)).toBe(true);
  });

  it('reserves fallback query slots for Chinese Bangumi aliases', () => {
    const queries = getBangumiTranslationFallbackQueries('吞噬魔物的冒險者', [
      '被魔物吃掉的冒險者',
      '魔物獵人的日常生活',
    ]);

    expect(queries).toHaveLength(4);
    expect(queries).toContain('掉的冒险者');
    expect(queries).toContain('日常生活');
  });

  it('does not generate unsafe three-character fallback queries', () => {
    expect(getBangumiTranslationFallbackQueries('膽大黨')).toEqual([]);
    expect(
      getBangumiTranslationFallbackQueries('我獨自升級').every(
        (query) => query.length >= 4
      )
    ).toBe(true);
  });

  it('matches a fragment only against the reference title that produced it', () => {
    expect(
      isBangumiTranslationFallbackMatch('座艾莉同學 第一季', '座艾莉同學', [
        '鄰座艾莉同學 第二季',
        '完全不同作品 第一季',
      ])
    ).toBe(false);
  });

  it('rejects broad fragment candidates and conflicting seasons', () => {
    expect(
      isBangumiTranslationFallbackMatch('異世界的冒險者', '物的冒險者', [
        '吞噬魔物的冒險者',
      ])
    ).toBe(false);
    expect(
      isBangumiTranslationFallbackMatch(
        '吞噬魔物的冒險者 第三季',
        '物的冒險者',
        ['吞噬魔物的冒險者 第二季']
      )
    ).toBe(false);
    expect(
      isBangumiTranslationFallbackMatch('劇場版 吃魔物的冒險者', '物的冒險者', [
        '吞噬魔物的冒險者',
      ])
    ).toBe(false);
  });

  it('runs translation fallback only after normal Bangumi stages', () => {
    const plan = buildPlaybackSearchPlan({
      title: '吞噬魔物的冒險者',
      aliases: [],
      isBangumiCardSearch: true,
      includeFastStage: false,
    });

    expect(plan.map((stage) => stage.reason)).toEqual([
      'full',
      'translation-core',
    ]);
    expect(plan[1].limit).toBe(4);
    expect(plan[1].translationFallback).toBe(true);
  });

  it('keeps popular anime aliases data-driven through Bangumi aliases', () => {
    expect(getFastSourceSearchQueries('SAKAMOTO DAYS')).toContain(
      'SAKAMOTODAYS'
    );

    const plan = buildPlaybackSearchPlan({
      title: 'SAKAMOTO DAYS',
      aliases: ['\u5742\u672c\u65e5\u5e38'],
      isBangumiCardSearch: true,
      includeFastStage: false,
    });

    expect(plan[0].reason).toBe('bangumi-alias');
    expect(plan[0].queries).toContain('\u5742\u672c\u65e5\u5e38');
  });

  it('uses only Chinese aliases for China-source fallback queries', () => {
    const queries = getChineseAliasSourceSearchQueries([
      '尖帽子的魔法工房',
      'とんがり帽子のアトリエ',
      'Witch Hat Atelier',
    ]);

    expect(queries).toContain('尖帽子的魔法工房');
    expect(queries).not.toContain('とんがり帽子のアトリエ');
    expect(queries).not.toContain('Witch Hat Atelier');
  });

  it('still deduplicates legacy play records without direct source identity by title', () => {
    const records = deduplicatePlayRecordList([
      {
        key: 'legacy-a',
        title: '沒有辣妹會對阿宅溫柔!?',
        source_name: 'A 資源',
        save_time: 100,
      },
      {
        key: 'legacy-b',
        title: '沒有辣妹會對阿宅溫柔！？',
        source_name: 'B 資源',
        save_time: 200,
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].key).toBe('legacy-b');
    expect(
      getPlayRecordKeysByIdentity(
        [
          {
            key: 'legacy-a',
            title: '沒有辣妹會對阿宅溫柔!?',
            save_time: 100,
          },
          {
            key: 'legacy-b',
            title: '沒有辣妹會對阿宅溫柔！？',
            save_time: 200,
          },
        ],
        records[0]
      )
    ).toEqual(['legacy-a', 'legacy-b']);
  });
});
