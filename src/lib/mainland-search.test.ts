import { getMainlandSearchQueries } from './mainland-search';
import { extractSeason } from './titleParser';

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

/**
 * 查詢計畫的 golden test。
 *
 * getMainlandSearchQueries 的輸出就是「實際送給陸源的查詢清單」——本 fork
 * 與外界的真實契約。它依賴 chinese.ts 的 generateSearchVariants（500+ 行，
 * 先前零測試）、opencc-mainland 的台灣詞彙對照、以及 regional-title-aliases
 * 的人工別名表；上面任何一層改動都會改變這裡送出的字串。
 *
 * 清單的「內容與順序」都有意義：第一個查詢是命中率最高的那個，排序退化不會
 * 讓任何逐項斷言失敗，但會實際降低搜尋成功率。因此用整體快照，讓任何變動
 * 在 review 時被看見。要刻意變更時用 `pnpm test -- -u` 更新並檢視 diff。
 */
describe('查詢計畫 golden test', () => {
  it.each([
    ['別名表命中', '進擊的巨人'],
    ['別名表＋季數', '鬼滅之刃 第二季'],
    ['台譯與陸名完全不同', '間諜家家酒'],
    ['台譯與陸名完全不同（海賊王／航海王）', '海賊王'],
    // 逐字轉換會把「鍊」轉成「链」（鎖鍊之意）而非正確的「炼」。
    // 正確的陸名必須靠 convertTaiwanToMainland 產生並排在第一位，
    // 逐字轉換的結果只能當備援。這條測試就是在守住這個順序。
    ['台灣詞彙對照優先於逐字轉換', '鋼之鍊金術師'],
    ['僅需字元轉換', '葬送的芙莉蓮'],
    ['副標題拆分', '咒術迴戰 懷玉玉折'],
    ['全形冒號副標題', '刀劍神域：序列爭戰'],
    // 帶明確季數的查詢：先前因「先剝季數再比對季數」而完全沒有備援，
    // 這幾條鎖住修正後的備援清單，並確保每個備援都仍帶著同一個季數。
    ['季數＋別名表', '間諜家家酒 第二季'],
    ['季數用阿拉伯數字', '某劇 第2季'],
    ['長片名＋季數', '石紀元 科學與未來 第三季'],
    ['純英文（不送陸源）', 'Breaking Bad'],
    ['日文假名（不送陸源）', '進撃の巨人'],
  ])('%s：%s', (_label, query) => {
    expect(getMainlandSearchQueries(query)).toMatchSnapshot();
  });

  it('永遠不超過上限六個查詢', () => {
    const long = '落第賢者的學院無雙第二回轉生，S等級作弊魔術師冒險記 第三季';
    expect(getMainlandSearchQueries(long).length).toBeLessThanOrEqual(6);
  });

  it('鋼之鍊金術師：正確的陸名必須排在逐字轉換之前', () => {
    const queries = getMainlandSearchQueries('鋼之鍊金術師');
    const correct = queries.indexOf('钢之炼金术师');
    const naive = queries.indexOf('钢之链金术师');

    expect(correct).toBe(0);
    // 逐字轉換版本可以存在（當備援），但不得排在正確版本之前
    if (naive !== -1) expect(naive).toBeGreaterThan(correct);
  });

  /**
   * 不變式：帶明確季數的查詢，每一個備援都必須帶著同一個季數。
   *
   * 放寬季數過濾會讓第二季的搜尋回退到第一季的查詢——使用者搜第二季卻拿到
   * 第一季的結果，而且不會有任何錯誤。這條用多組輸入守住，避免日後為了
   * 「多一點備援」而把過濾拿掉。
   */
  it.each([
    ['鬼滅之刃 第二季', 2],
    ['間諜家家酒 第二季', 2],
    ['石紀元 科學與未來 第三季', 3],
    ['葬送的芙莉蓮 第一季', 1],
    ['某劇 第2季', 2],
  ])('%s：每個備援都帶著第 %i 季', (query, season) => {
    const queries = getMainlandSearchQueries(query);

    expect(queries.length).toBeGreaterThan(0);
    for (const generated of queries) {
      expect(extractSeason(generated)).toBe(season);
    }
  });

  it('無季數的查詢不受季數過濾影響', () => {
    // 這幾個沒有季數，備援清單應該照舊涵蓋別名與短核心
    expect(getMainlandSearchQueries('進擊的巨人')).toContain('巨人');
    expect(getMainlandSearchQueries('海賊王')).toContain('航海王');
  });
});
