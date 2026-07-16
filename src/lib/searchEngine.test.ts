import { cleanQueryForApi, toDisplayLanguage } from './chinese';
import {
  __searchEngineInternals,
  getTitleMatchScore,
  isFuzzyMatch,
} from './searchEngine';
import {
  extractPart,
  extractSeason,
  inferSeasonFromSubtitle,
} from './titleParser';

const {
  getLongestCommonSubstring,
  getLongestCommonSubsequence,
  passesHybridCoverage,
} = __searchEngineInternals;

describe('searchEngine fuzzy match tests', () => {
  it('should not match different seasons or spin-offs', () => {
    const res1 = isFuzzyMatch(
      '關於我轉生變成史萊姆這檔事 蒼海之淚篇',
      '關於我轉生變成史萊姆這檔事 第四季'
    );
    expect(res1).toBe(false);
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 第四季',
        '關於我轉生變成史萊姆這檔事 蒼海之淚篇'
      )
    ).toBe(false);
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 蒼海之淚篇',
        '転生したらスライムだった件 第4期'
      )
    ).toBe(false);
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 蒼海之淚篇',
        '転生したらスライムだった件 第四期'
      )
    ).toBe(false);

    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 第二季',
        '關於我轉生變成史萊姆這檔事 第三季'
      )
    ).toBe(false);

    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 第二季',
        '關於我轉生變成史萊姆這檔事'
      )
    ).toBe(true);
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事',
        '關於我轉生變成史萊姆這檔事 第二季'
      )
    ).toBe(false);

    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 轉生史萊姆日記',
        '關於我轉生變成史萊姆這檔事'
      )
    ).toBe(true);
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事',
        '關於我轉生變成史萊姆這檔事 轉生史萊姆日記'
      )
    ).toBe(false);
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 蒼海之淚篇',
        '關於我轉生變成史萊姆這檔事 紅蓮之絆篇'
      )
    ).toBe(false);
  });

  it('should match same season with spelling / simplification differences', () => {
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 第四季',
        '关于我转生变成史莱姆这档事 第四季'
      )
    ).toBe(true);
    expect(
      isFuzzyMatch(
        '關於我轉生變成史萊姆這檔事 第四季 Part 2',
        '關於我轉生變成史萊姆這檔事 第四季'
      )
    ).toBe(true);
  });

  it('should match anime aliases when Bangumi provides traditional Chinese titles', () => {
    expect(
      isFuzzyMatch(
        '废柴风纪委员与裙子长度不合规的JK的故事',
        '木頭風紀委員和迷你裙JK的故事'
      )
    ).toBe(true);

    expect(
      getTitleMatchScore(
        '废柴风纪委员与裙子长度不合规的JK的故事',
        '木頭風紀委員和迷你裙JK的故事'
      )
    ).toBeGreaterThan(0);
  });

  it('should match Japanese kana anime titles to generated CJK aliases', () => {
    expect(isFuzzyMatch('北海道動物', 'ほっかいどうぶつ')).toBe(true);
    expect(isFuzzyMatch('北海道动物', 'ほっかいどうぶつ')).toBe(true);

    expect(
      getTitleMatchScore('北海道動物', 'ほっかいどうぶつ')
    ).toBeGreaterThan(0);
  });

  it('should rank exact season sources above side-story movie sources', () => {
    const query = '關於我轉生變成史萊姆這檔事 第四季';

    expect(
      getTitleMatchScore('關於我轉生變成史萊姆這檔事 第四季', query)
    ).toBeGreaterThan(
      getTitleMatchScore('關於我轉生變成史萊姆這檔事 蒼海之淚篇', query)
    );
    expect(isFuzzyMatch('關於我轉生變成史萊姆這檔事 蒼海之淚篇', query)).toBe(
      false
    );
  });

  it('should extract season numbers correctly', () => {
    expect(extractSeason('關於我轉生變成史萊姆這檔事 第四季')).toBe(4);
    expect(extractSeason('關於我轉生變成史萊姆這檔事 Season 3')).toBe(3);
    expect(extractSeason('關於我轉生變成史萊姆這檔事 S2')).toBe(2);
    expect(extractSeason('關於我轉生變成史萊姆這檔事 Part 1')).toBe(1);
    expect(extractSeason('關於我轉生變成史萊姆這檔事 IV')).toBe(4);
    expect(extractSeason('關於我轉生變成史萊姆這檔事 II')).toBe(2);
    expect(extractSeason('關於我轉生變成史萊姆這檔事 5')).toBe(5);
    expect(extractSeason('關於我轉生變成史萊姆這檔事-3')).toBe(3);
    expect(extractSeason('關於我轉生變成史萊姆這檔事')).toBeNull();
  });

  it('should extract part numbers correctly', () => {
    expect(extractPart('關於我轉生變成史萊姆這檔事 Part 3')).toBe(3);
    expect(extractPart('關於我轉生變成史萊姆這檔事 第3部分')).toBe(3);
    expect(extractPart('石紀元第四季 prat2')).toBe(2);
    expect(extractPart('石紀元第四季 pt 1')).toBe(1);
    expect(extractPart('關於我轉生變成史萊姆這檔事')).toBeNull();
  });

  it('should infer season from subtitle correctly', () => {
    expect(inferSeasonFromSubtitle('石紀元 科學與未來')).toBe(4);
    expect(extractSeason('石紀元 科學與未來 第3部分')).toBe(4);
  });

  it('should match anime titles with different parts and seasons correctly', () => {
    expect(isFuzzyMatch('石紀元第四季Part3', '石紀元 科學與未來 第3部分')).toBe(
      true
    );
    expect(isFuzzyMatch('石紀元第四季Part2', '石紀元 科學與未來 第3部分')).toBe(
      false
    );
  });
});

describe('hybrid LCS precision guards', () => {
  it('prefers contiguous substring over scattered subsequence', () => {
    // 成龙历险记 vs 龙珠历险记：子序列可湊 4+，但連續核心不夠長
    expect(
      getLongestCommonSubsequence('成龙历险记', '龙珠历险记')
    ).toBeGreaterThanOrEqual(4);
    expect(getLongestCommonSubstring('成龙历险记', '龙珠历险记')).toBeLessThan(
      4
    );
    expect(isFuzzyMatch('成龙历险记', '龙珠历险记')).toBe(false);
    expect(isFuzzyMatch('龍珠歷險記', '成龍歷險記')).toBe(false);
  });

  it('rejects unrelated titles that only share scattered characters', () => {
    expect(isFuzzyMatch('排球少年', '少年派的奇幻漂流')).toBe(false);
    expect(isFuzzyMatch('三體', '三生三世十里桃花')).toBe(false);
    expect(isFuzzyMatch('鬼滅之刃', '刀劍神域')).toBe(false);
  });

  it('still matches near-identical titles with minor noise', () => {
    expect(
      isFuzzyMatch(
        '最强的职业不是勇者也不是贤者好像是鉴定士(伪)的样子?',
        '最强的职业不是勇者工... (伪)...'
      )
    ).toBe(true);
    expect(isFuzzyMatch('尖帽子的魔法工坊', '尖帽子的魔法工房')).toBe(true);
  });

  it('passes hybrid coverage only with strong contiguous core', () => {
    expect(passesHybridCoverage('成龙历险记', '龙珠历险记', 0.65)).toBe(false);
    // 已標準化為同一字形時，長連續核心應通過
    expect(
      passesHybridCoverage(
        '关于我转生变成史莱姆这档事',
        '关于我转生变成史莱姆这档事',
        0.65
      )
    ).toBe(true);
    expect(
      passesHybridCoverage('尖帽子的魔法工坊', '尖帽子的魔法工房', 0.65)
    ).toBe(true);
  });
});

describe('toDisplayLanguage translation tests', () => {
  it('should translate simplified Chinese to traditional Chinese with correct priority (length-descending)', () => {
    expect(toDisplayLanguage('设置')).toBe('設定');
    expect(toDisplayLanguage('视频')).toBe('影片');
    expect(toDisplayLanguage('网络')).toBe('網路');
  });

  it('should handle normal single character conversions as fallback', () => {
    expect(toDisplayLanguage('设')).toBe('設');
    expect(toDisplayLanguage('视')).toBe('視');
    expect(toDisplayLanguage('网')).toBe('網');
  });

  it('should localize API display fields from simplified Chinese', () => {
    expect(toDisplayLanguage('电影天堂资源')).toBe('電影天堂資源');
    expect(toDisplayLanguage('国产电视剧')).toBe('國產電視劇');
  });
});

describe('cleanQueryForApi regression tests', () => {
  it('should preserve short title-relevant parenthetical content', () => {
    expect(
      cleanQueryForApi('最强的职业不是勇者也不是贤者好像是鉴定士(伪)的样子')
    ).toContain('(伪)');
    expect(cleanQueryForApi('勇者斗恶龙(仮)')).toContain('(仮)');
    expect(cleanQueryForApi('魔王学院的不适合者(II)')).toContain('(II)');
  });

  it('should strip season/quality metadata parentheticals', () => {
    const r1 = cleanQueryForApi('關於我轉生變成史萊姆這檔事(第一季)');
    expect(r1).not.toContain('(第一季)');
    expect(r1).not.toContain('第一季');

    const r2 = cleanQueryForApi('鬼滅之刃（僅限）');
    expect(r2).not.toContain('僅限');

    const r3 = cleanQueryForApi('進擊的巨人(中字)');
    expect(r3).not.toContain('(中字)');

    const r4 = cleanQueryForApi('無職轉生(Season 2)');
    expect(r4).not.toContain('Season 2');

    const r5 = cleanQueryForApi('咒術迴戰(第2季)');
    expect(r5).not.toContain('第2季');
  });

  it('should still convert Japanese particles', () => {
    const result = cleanQueryForApi('進撃の巨人');
    expect(result).toContain('的');
    expect(result).not.toContain('の');
  });

  it('should still strip trailing season suffixes', () => {
    const result = cleanQueryForApi('鬼滅之刃 第二季');
    expect(result).not.toContain('第二季');
    expect(result).toBe('鬼滅之刃');
  });

  it('should strip square brackets and their contents', () => {
    const r1 = cleanQueryForApi('【4月新番】鬼滅之刃 [1080P]');
    expect(r1).not.toContain('4月新番');
    expect(r1).not.toContain('1080P');
    expect(r1).toBe('鬼滅之刃');

    const r2 = cleanQueryForApi('[木棉花] 鬼滅之刃');
    expect(r2).not.toContain('木棉花');
    expect(r2).toBe('鬼滅之刃');
  });

  it('should match long titles with their short core priority variants', () => {
    const match = isFuzzyMatch(
      '最强的职业不是勇者也不是贤者好像是鉴定士(伪)的样子?',
      '最强的职业'
    );
    expect(match).toBe(true);
  });

  it('should match when query has ellipsis and typo like 工/士', () => {
    const query = '最强的职业不是勇者工... (伪)...';
    const title = '最强的职业不是勇者也不是贤者好像是鉴定士(伪)的样子?';
    expect(isFuzzyMatch(title, query)).toBe(true);
  });

  it('should match complete long query against shorter truncated results without being filtered by length', () => {
    const fullQuery = '最强的职业不是勇者也不是贤者好像是鉴定士(伪)的样子?';

    expect(isFuzzyMatch('最强的职业不是勇者', fullQuery)).toBe(true);
    expect(isFuzzyMatch('最强的职业不是勇者(伪)', fullQuery)).toBe(true);
    expect(
      isFuzzyMatch('最强的职业不是勇者也不是贤者好像是鉴定士(伪)', fullQuery)
    ).toBe(true);
  });

  it('should match common alias translations like A Song of Ice and Fire / Game of Thrones', () => {
    expect(isFuzzyMatch('权力的游戏第八季', '冰與火之歌')).toBe(true);
    expect(isFuzzyMatch('權力的遊戲第一季', '冰与火之歌')).toBe(true);
    expect(isFuzzyMatch('航海王', '海贼王')).toBe(true);
    expect(isFuzzyMatch('名偵探柯南', '名侦探柯南')).toBe(true);
  });

  it('should fuzzy match Bangumi Japanese anime titles with Chinese source aliases', () => {
    expect(isFuzzyMatch('尖帽子的魔法工坊', '尖帽子的魔法工房')).toBe(true);
  });
});

describe('標題正規化容錯（NFKC 與噪音字元）', () => {
  it('間隔號 · 與 ・ 不影響匹配', () => {
    expect(isFuzzyMatch('哈利·波特与魔法石', '哈利波特与魔法石')).toBe(true);
    expect(isFuzzyMatch('刀剑神域・序列之争', '刀剑神域 序列之争')).toBe(true);
  });

  it('波浪號副標題（～ 〜 ~）不影響匹配', () => {
    expect(
      isFuzzyMatch(
        '无职转生～到了异世界就拿出真本事～',
        '无职转生 到了异世界就拿出真本事'
      )
    ).toBe(true);
  });

  it('全形英數字自動轉半形比對', () => {
    expect(
      isFuzzyMatch('ＳＰＹ×ＦＡＭＩＬＹ间谍过家家', 'SPY×FAMILY间谍过家家')
    ).toBe(true);
  });

  it('全形空白（U+3000）視同一般空白', () => {
    expect(isFuzzyMatch('葬送的芙莉莲　第二季', '葬送的芙莉莲 第二季')).toBe(
      true
    );
  });
});
