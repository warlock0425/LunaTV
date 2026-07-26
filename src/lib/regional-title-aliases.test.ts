import { getRegionalMainlandTitles } from './regional-title-aliases';

describe('regional title aliases', () => {
  it('keeps season metadata when replacing a Taiwan title', () => {
    expect(getRegionalMainlandTitles('間諜家家酒 第二季')).toEqual([
      '间谍过家家 第二季',
    ]);
  });

  it('supports a verified secondary mainland title', () => {
    expect(getRegionalMainlandTitles('藥師少女的獨語')).toEqual([
      '药屋少女的呢喃',
      '药师少女的独语',
    ]);
  });

  it('does not guess unknown titles', () => {
    expect(getRegionalMainlandTitles('進擊的巨人')).toEqual([]);
  });

  it.each([
    ['玩命關頭9', '速度与激情9'],
    ['星際效應', '星际穿越'],
    ['全面啟動', '盗梦空间'],
    ['動物方城市2', '疯狂动物城2'],
    ['腦筋急轉彎2', '头脑特工队2'],
    ['惡靈古堡', '生化危机'],
  ])('maps Taiwan title %s to mainland title %s', (tw, cn) => {
    expect(getRegionalMainlandTitles(tw)[0]).toBe(cn);
  });

  // 新增條目：字元轉換無法解決，且簡體名已在豆瓣確認存在
  it.each([
    ['機動戰士鋼彈', '机动战士高达'],
    ['蜘蛛人', '蜘蛛侠'],
    ['鋼鐵人3', '钢铁侠3'],
    ['中華一番', '中华小当家'],
    ['棋靈王', '棋魂'],
  ])('maps Taiwan title %s to mainland title %s', (tw, cn) => {
    expect(getRegionalMainlandTitles(tw)[0]).toBe(cn);
  });

  it('prefers the longer, more specific alias over the bare term', () => {
    // 「機動戰士鋼彈」比「鋼彈」長，排序後應先命中，不會產生「机动战士高达」以外的結果
    expect(getRegionalMainlandTitles('機動戰士鋼彈')[0]).toBe('机动战士高达');
    expect(getRegionalMainlandTitles('SD鋼彈')[0]).toBe('SD高达');
  });
});
