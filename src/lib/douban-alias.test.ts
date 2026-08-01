import {
  buildDoubanSearchUrl,
  DoubanSearchResponse,
  extractMainlandAliases,
  isAliasWorthRetrying,
  pickPrimaryAlias,
} from './douban-alias';

const wrap = (titles: string[]): DoubanSearchResponse => ({
  subjects: { items: titles.map((title) => ({ target: { title } })) },
});

describe('buildDoubanSearchUrl', () => {
  it('依代理類型組出搜尋網址並編碼查詢', () => {
    const url = buildDoubanSearchUrl('魔戒', 'cmliussss-cdn-tencent');
    expect(url).toContain('m.douban.cmliussss.net');
    expect(url).toContain(`q=${encodeURIComponent('魔戒')}`);
  });

  it('未知代理類型退回預設主機', () => {
    expect(buildDoubanSearchUrl('魔戒', 'unknown-proxy')).toContain(
      'm.douban.cmliussss.net'
    );
  });

  // proxyType 直接來自查詢參數。這些 key 在原型鏈上有值且為 truthy，
  // 直接索引會讓預設值失效，拼出必然解析失敗的網址。
  it.each([
    'constructor',
    'toString',
    'valueOf',
    '__proto__',
    'hasOwnProperty',
  ])('原型鏈上的 key %s 一樣退回預設主機，且組得出合法網址', (proxyType) => {
    const url = buildDoubanSearchUrl('魔戒', proxyType);

    expect(url).toContain('m.douban.cmliussss.net');
    expect(() => new URL(url)).not.toThrow();
  });
});

describe('extractMainlandAliases', () => {
  it('取出與原查詢不同的大陸片名', () => {
    const payload = wrap(['指环王1：护戒使者', '指环王2：双塔奇兵']);
    expect(extractMainlandAliases(payload, '魔戒')).toEqual([
      '指环王1：护戒使者',
      '指环王2：双塔奇兵',
    ]);
  });

  it('過濾掉與原查詢字元轉換後相同的標題', () => {
    // 「魷魚遊戲」本來就能靠字元轉換命中，不需要別名
    const payload = wrap(['鱿鱼游戏']);
    expect(extractMainlandAliases(payload, '魷魚遊戲')).toEqual([]);
  });

  it('略過不含中日韓字的標題', () => {
    const payload = wrap(['Interstellar', '星际穿越']);
    expect(extractMainlandAliases(payload, '星際效應')).toEqual(['星际穿越']);
  });

  it('去除重複並套用數量上限', () => {
    const payload = wrap(['头号玩家', '头号玩家', '头号玩家2', '头号玩家3']);
    expect(extractMainlandAliases(payload, '一級玩家', 2)).toEqual([
      '头号玩家',
      '头号玩家2',
    ]);
  });

  it('空回應回傳空陣列', () => {
    expect(extractMainlandAliases({}, '魔戒')).toEqual([]);
  });
});

describe('pickPrimaryAlias', () => {
  it('去掉集數與副標題還原系列主名', () => {
    expect(pickPrimaryAlias(['指环王1：护戒使者', '指环王2：双塔奇兵'])).toBe(
      '指环王'
    );
  });

  it('去掉季別後綴', () => {
    expect(pickPrimaryAlias(['心灵猎人 第一季'])).toBe('心灵猎人');
  });

  it('無尾綴的標題原樣回傳', () => {
    expect(pickPrimaryAlias(['心灵奇旅'])).toBe('心灵奇旅');
  });

  it('不跨不同作品取共同前綴（鋼鐵人不得變成「钢铁」）', () => {
    // 豆瓣搜「鋼鐵人」會同時回傳「钢铁侠」與另一部片「钢铁巨人」
    expect(pickPrimaryAlias(['钢铁侠', '钢铁巨人', '钢铁侠3'])).toBe('钢铁侠');
  });

  it('僅取第一筆，不受後續無關結果影響', () => {
    expect(pickPrimaryAlias(['头号玩家', '心灵奇旅'])).toBe('头号玩家');
  });

  it('去尾綴後過短時退回原標題', () => {
    expect(pickPrimaryAlias(['第一季'])).toBe('第一季');
  });

  it('無候選回傳 null', () => {
    expect(pickPrimaryAlias([])).toBeNull();
  });
});

describe('isAliasWorthRetrying', () => {
  it('與原查詢實質不同的別名值得重搜', () => {
    expect(isAliasWorthRetrying('指环王', '魔戒')).toBe(true);
  });

  it('與原查詢已能模糊匹配的別名不需重搜', () => {
    expect(isAliasWorthRetrying('鱿鱼游戏', '魷魚遊戲')).toBe(false);
  });

  it('空別名不重搜', () => {
    expect(isAliasWorthRetrying('', '魔戒')).toBe(false);
  });
});
