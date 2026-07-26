export interface RegionalTitleAlias {
  tw: string;
  cn: string;
  alternatives?: string[];
}

/**
 * Verified Taiwan-to-mainland title differences that cannot be solved by
 * character conversion alone. Keep this list deliberately curated: a wrong
 * alias is worse than a missed fallback when searching third-party CMS data.
 */
export const REGIONAL_TITLE_ALIASES: RegionalTitleAlias[] = [
  { tw: '間諜家家酒', cn: '间谍过家家' },
  { tw: '航海王', cn: '海贼王' },
  { tw: '神隱少女', cn: '千与千寻' },
  { tw: '魔法公主', cn: '幽灵公主' },
  { tw: '霍爾的移動城堡', cn: '哈尔的移动城堡' },
  { tw: '借物少女艾莉緹', cn: '借东西的小人阿莉埃蒂' },
  {
    tw: '藥師少女的獨語',
    cn: '药屋少女的呢喃',
    alternatives: ['药师少女的独语'],
  },
  { tw: '玩命關頭', cn: '速度与激情' },
  { tw: '星際效應', cn: '星际穿越' },
  { tw: '全面啟動', cn: '盗梦空间' },
  { tw: '動物方城市', cn: '疯狂动物城' },
  { tw: '腦筋急轉彎', cn: '头脑特工队' },
  { tw: '惡靈古堡', cn: '生化危机' },
  { tw: '金牌特務', cn: '王牌特工' },
  { tw: '駭客任務', cn: '黑客帝国' },
  { tw: '神鬼奇航', cn: '加勒比海盗' },
  { tw: '明日邊界', cn: '明日边缘' },
  { tw: '刺激1995', cn: '肖申克的救赎' },
  { tw: '三個傻瓜', cn: '三傻大闹宝莱坞' },
  { tw: '我和我的冠軍女兒', cn: '摔跤吧爸爸' },
  { tw: '可可夜總會', cn: '寻梦环游记', alternatives: ['coco夜总会'] },
  { tw: 'COCO夜總會', cn: '寻梦环游记' },
  { tw: '鐵達尼號', cn: '泰坦尼克号' },
  { tw: '捍衛任務', cn: '疾速追杀' },
  { tw: '鏈鋸人', cn: '电锯人' },
  { tw: '冰與火之歌', cn: '权力的游戏' },
  // 以下每筆都先確認兩件事才收錄：
  // (1) 繁簡轉換無法解決（鋼彈→钢弹、蜘蛛人→蜘蛛人、棋靈王→棋灵王…）
  // (2) 簡體名在豆瓣確實查得到對應作品
  { tw: '機動戰士鋼彈', cn: '机动战士高达' },
  { tw: '鋼彈', cn: '高达' },
  { tw: '蜘蛛人', cn: '蜘蛛侠' },
  { tw: '鋼鐵人', cn: '钢铁侠' },
  { tw: '中華一番', cn: '中华小当家' },
  { tw: '棋靈王', cn: '棋魂' },
];

const SORTED_ALIASES = [...REGIONAL_TITLE_ALIASES].sort(
  (a, b) => b.tw.length - a.tw.length
);

export function getRegionalMainlandTitles(query: string): string[] {
  for (const alias of SORTED_ALIASES) {
    if (!query.includes(alias.tw)) continue;
    const replaceTitle = (title: string) => query.replace(alias.tw, title);
    return [alias.cn, ...(alias.alternatives || [])].map(replaceTitle);
  }
  return [];
}
