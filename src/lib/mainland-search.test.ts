import { getMainlandSearchQueries } from './mainland-search';

describe('mainland search query planner', () => {
  it('puts the simplified mainland query first', () => {
    const queries = getMainlandSearchQueries('進擊的巨人 第二季');

    expect(queries[0]).toBe('进击的巨人 第二季');
    expect(queries.length).toBeLessThanOrEqual(6);
  });

  it('prefers a verified mainland title over plain character conversion', () => {
    expect(getMainlandSearchQueries('間諜家家酒 第二季').slice(0, 2)).toEqual([
      '间谍过家家 第二季',
      '间谍家家酒 第二季',
    ]);
  });

  it('never sends Japanese or English variants to mainland CMS sources', () => {
    const queries = getMainlandSearchQueries('間諜家家酒');

    expect(queries.every((query) => /[\u3400-\u9fff]/.test(query))).toBe(true);
    expect(queries.length).toBeLessThanOrEqual(4);
    expect(getMainlandSearchQueries('Attack on Titan')).toEqual([]);
    expect(getMainlandSearchQueries('進撃の巨人')).toEqual([]);
  });

  it('keeps an explicit season in every generated query', () => {
    const queries = getMainlandSearchQueries('石紀元 科學與未來 第三季');

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => /第三季|第3季|3季/.test(query))).toBe(true);
  });

  it('fully simplifies and splits useful parts of a long Taiwan title', () => {
    const queries = getMainlandSearchQueries(
      '落第賢者的學院無雙第二回轉生，S等級作弊魔術師冒險記'
    );

    expect(queries[0]).toBe(
      '落第贤者的学院无双第二回转生，S等级作弊魔术师冒险记'
    );
    expect(queries).toContain('落第贤者的学院无双第二回转生');
    expect(queries).toContain('S等级作弊魔术师冒险记');
  });
});
