/* eslint-disable unused-imports/no-unused-vars */

import { convertS2T, convertT2S } from './s2t';

// This module provides Traditional Chinese conversion utilities for search

const MAX_SEARCH_VARIANTS = 12;

const CHINESE_TO_ARABIC: { [key: string]: string } = {
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
};

const ARABIC_TO_CHINESE = [
  '',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
];

/** 只轉全形英數與全形空白（保留全形標點——CMS 片名常含全形標點） */
function normalizeFullwidthAlnum(text: string): string {
  return text
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, ' ');
}

export function toSearchSimplified(text: string): string {
  // 這裡原本在轉換器之後逐字補了 36 個字（進→进、擊→击……），看起來像是
  // 不信任轉換器而逐一打補丁。以 38 個真實片名語料實測，其中 35 個轉換器
  // 本來就處理正確，移除後輸出完全一致，因此只保留唯一必要的那一個。
  //
  // 迴／回 在繁體是兩個不同的字（輪迴、迴轉），簡體才合併為「回」，
  // 轉換器不動它是正確行為，故仍需補上——少了這個，「咒術迴戰」會轉成
  // 「咒术迴战」而搜不到任何陸源。此行為由 s2t-real.test.ts 看守。
  return convertT2S(normalizeFullwidthAlnum(text)).replace(/迴/g, '回');
}

export function generateNumberVariant(query: string): string | null {
  const chinesePattern = /第([一二三四五六七八九十])(季|部|集|期)/;
  const chineseMatch = chinesePattern.exec(query);
  if (chineseMatch) {
    const chineseNum = chineseMatch[1];
    const arabicNum = CHINESE_TO_ARABIC[chineseNum];
    if (arabicNum) {
      const base = query.replace(chineseMatch[0], '').trim();
      if (base) {
        return `${base}${arabicNum}`;
      }
    }
  }

  const arabicPattern = /第(\d+)(季|部|集|期)/;
  const arabicMatch = arabicPattern.exec(query);
  if (arabicMatch) {
    const num = parseInt(arabicMatch[1]);
    const suffix = arabicMatch[2];
    if (num >= 1 && num <= 10) {
      const chineseNum = ARABIC_TO_CHINESE[num];
      return query.replace(arabicMatch[0], `第${chineseNum}${suffix}`);
    }
  }

  const endNumberMatch = query.match(/^(.+?)(\d+)$/);
  if (endNumberMatch) {
    const base = endNumberMatch[1].trim();
    const num = parseInt(endNumberMatch[2]);
    if (num >= 1 && num <= 10 && base) {
      const chineseNum = ARABIC_TO_CHINESE[num];
      return `${base}第${chineseNum}季`;
    }
  }

  return null;
}

function generatePunctuationVariant(query: string): string | null {
  if (query.includes('：')) {
    return query.replace(/：/g, ' ');
  }
  if (query.includes(':')) {
    return query.replace(/:/g, ' ');
  }
  if (query.includes('《') || query.includes('》')) {
    return query.replace(/[《》]/g, '');
  }
  return null;
}

const KANA_ROMAJI: Record<string, string> = {
  あ: 'a',
  い: 'i',
  う: 'u',
  え: 'e',
  お: 'o',
  か: 'ka',
  き: 'ki',
  く: 'ku',
  け: 'ke',
  こ: 'ko',
  さ: 'sa',
  し: 'shi',
  す: 'su',
  せ: 'se',
  そ: 'so',
  た: 'ta',
  ち: 'chi',
  つ: 'tsu',
  て: 'te',
  と: 'to',
  な: 'na',
  に: 'ni',
  ぬ: 'nu',
  ね: 'ne',
  の: 'no',
  は: 'ha',
  ひ: 'hi',
  ふ: 'fu',
  へ: 'he',
  ほ: 'ho',
  ま: 'ma',
  み: 'mi',
  む: 'mu',
  め: 'me',
  も: 'mo',
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  ら: 'ra',
  り: 'ri',
  る: 'ru',
  れ: 're',
  ろ: 'ro',
  わ: 'wa',
  を: 'wo',
  ん: 'n',
  が: 'ga',
  ぎ: 'gi',
  ぐ: 'gu',
  げ: 'ge',
  ご: 'go',
  ざ: 'za',
  じ: 'ji',
  ず: 'zu',
  ぜ: 'ze',
  ぞ: 'zo',
  だ: 'da',
  ぢ: 'ji',
  づ: 'zu',
  で: 'de',
  ど: 'do',
  ば: 'ba',
  び: 'bi',
  ぶ: 'bu',
  べ: 'be',
  ぼ: 'bo',
  ぱ: 'pa',
  ぴ: 'pi',
  ぷ: 'pu',
  ぺ: 'pe',
  ぽ: 'po',
  きゃ: 'kya',
  きゅ: 'kyu',
  きょ: 'kyo',
  しゃ: 'sha',
  しゅ: 'shu',
  しょ: 'sho',
  ちゃ: 'cha',
  ちゅ: 'chu',
  ちょ: 'cho',
  にゃ: 'nya',
  にゅ: 'nyu',
  にょ: 'nyo',
  ひゃ: 'hya',
  ひゅ: 'hyu',
  ひょ: 'hyo',
  みゃ: 'mya',
  みゅ: 'myu',
  みょ: 'myo',
  りゃ: 'rya',
  りゅ: 'ryu',
  りょ: 'ryo',
  ぎゃ: 'gya',
  ぎゅ: 'gyu',
  ぎょ: 'gyo',
  じゃ: 'ja',
  じゅ: 'ju',
  じょ: 'jo',
  びゃ: 'bya',
  びゅ: 'byu',
  びょ: 'byo',
  ぴゃ: 'pya',
  ぴゅ: 'pyu',
  ぴょ: 'pyo',
};

function katakanaToHiragana(text: string): string {
  return text.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

function romanizeKana(text: string): string | null {
  if (!/[ぁ-ゖァ-ヶ]/.test(text)) return null;

  const hira = katakanaToHiragana(text);
  const parts: string[] = [];
  let doubleNext = false;

  for (let index = 0; index < hira.length; index++) {
    const char = hira[index];
    if (char === 'っ') {
      doubleNext = true;
      continue;
    }
    if (char === 'ー') {
      continue;
    }

    const pair = hira.slice(index, index + 2);
    let romaji = KANA_ROMAJI[pair];
    if (romaji) {
      index += 1;
    } else {
      romaji = KANA_ROMAJI[char];
    }

    if (romaji) {
      if (doubleNext) {
        romaji = romaji[0] + romaji;
        doubleNext = false;
      }
      parts.push(romaji);
    } else if (/[\sA-Za-z0-9]/.test(char)) {
      parts.push(char);
    }
  }

  const result = parts.join('').trim();
  return result.length >= 2 ? result : null;
}

const SEARCH_SEPARATOR_PATTERN =
  /[\s~～\-－—–・·,，.。:：!！?？《》「」『』【】（）()_、/\\|]+/g;
const SEARCH_CJK_PATTERN = /[\u3400-\u9fff]/;
const SEARCH_KANA_PATTERN = /[\u3040-\u30ff]/;

/** 陸源搜尋只走中文（含繁轉簡）。英文／日文原文不當額外查詢。 */
export function isCjkSearchQuery(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (SEARCH_KANA_PATTERN.test(value)) return false;
  return SEARCH_CJK_PATTERN.test(value);
}

function getPunctuationInsensitiveVariants(query: string): string[] {
  const simplified = toSearchSimplified(query.trim());
  const withSpaces = simplified
    .replace(SEARCH_SEPARATOR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutSeparators = simplified
    .replace(SEARCH_SEPARATOR_PATTERN, '')
    .trim();
  return [withSpaces, withoutSeparators].filter(Boolean);
}

export function generateSearchVariants(originalQuery: string): string[] {
  const trimmed = originalQuery.trim();
  const variants = new Set<string>();
  variants.add(trimmed);
  getPunctuationInsensitiveVariants(trimmed).forEach((variant) =>
    variants.add(variant)
  );
  const simplifiedTrimmed = toSearchSimplified(trimmed);
  const aliasMatchCandidates = new Set([trimmed, simplifiedTrimmed]);

  const numberVariant = generateNumberVariant(trimmed);
  if (numberVariant) {
    variants.add(numberVariant);
  }

  const punctuationVariant = generatePunctuationVariant(trimmed);
  if (punctuationVariant) {
    variants.add(punctuationVariant);
  }

  if (trimmed.includes(' ')) {
    const keywords = trimmed.split(/\s+/);
    if (keywords.length >= 2) {
      const lastKeyword = keywords[keywords.length - 1];
      if (/第|季|集|部|篇|章/.test(lastKeyword)) {
        const combined = keywords[0] + lastKeyword;
        variants.add(combined);
      }
      const noSpaces = trimmed.replace(/\s+/g, '');
      variants.add(noSpaces);
    }
  }

  // 處理全形轉半形
  const halfWidth = trimmed
    .replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, ' ');
  if (halfWidth !== trimmed) {
    variants.add(halfWidth);
    const hwLower = halfWidth.toLowerCase();
    if (hwLower !== halfWidth) {
      variants.add(hwLower);
    }
  }

  // 處理英文大小寫，僅保留小寫作為備援
  const lower = trimmed.toLowerCase();
  if (lower !== trimmed) {
    variants.add(lower);
  }

  // 自定義動漫/影集名稱別名映射
  const ALIAS_MAP: Record<string, string[]> = {
    木头风纪委员和迷你裙JK: [
      '废柴风纪委员与裙子长度不合规的JK',
      '废柴风纪委员',
    ],
    木頭風紀委員和迷你裙JK: [
      '废柴风纪委员与裙子长度不合规的JK',
      '废柴风纪委员',
    ],
    木头风纪委员和迷你裙JK的故事: [
      '废柴风纪委员与裙子长度不合规的JK的故事',
      '废柴风纪委员',
    ],
    木頭風紀委員和迷你裙JK的故事: [
      '废柴风纪委员与裙子长度不合规的JK的故事',
      '废柴风纪委员',
    ],
    废柴风纪委员与裙子长度不合规的JK的故事: [
      '木头风纪委员和迷你裙JK的故事',
      '木头风纪委员',
    ],
    ほっかいどうぶつ: [
      '北海道動物',
      '北海道动物',
      'ほっかいどうぶつ学園',
      '北海道動物學園',
      '北海道动物学园',
      'Hokkaido Animals',
      'Hokkaido Doubutsu',
    ],
    ほっかいどうぶつ学園: [
      'ほっかいどうぶつ',
      '北海道動物',
      '北海道动物',
      '北海道動物學園',
      '北海道动物学园',
      'Hokkaido Animals',
      'Hokkaido Doubutsu',
    ],
    北海道動物: ['ほっかいどうぶつ', '北海道动物', 'Hokkaido Animals'],
    北海道动物: ['ほっかいどうぶつ', '北海道動物', 'Hokkaido Animals'],
    // 新增熱門影視與動漫別名對照表
    冰与火之歌: ['权力的游戏', '權力的遊戲', 'Game of Thrones', 'GOT'],
    冰與火之歌: ['权力的游戏', '權力的遊戲', 'Game of Thrones', 'GOT'],
    权力的游戏: ['冰与火之歌', '冰與火之歌', 'Game of Thrones', 'GOT'],
    權力的遊戲: ['冰与火之歌', '冰與火之歌', 'Game of Thrones', 'GOT'],
    海贼王: ['航海王', 'One Piece'],
    海賊王: ['航海王', 'One Piece'],
    航海王: ['海贼王', '海賊王', 'One Piece'],
    名侦探柯南: ['名偵探柯南', '柯南', 'Detective Conan'],
    名偵探柯南: ['名侦探柯南', '柯南', 'Detective Conan'],
    进击的巨人: ['進擊的巨人', '巨人', 'Attack on Titan'],
    進擊的巨人: ['进击的巨人', '巨人', 'Attack on Titan'],
    鬼灭之刃: ['鬼滅之刃', '鬼灭', 'Demon Slayer'],
    鬼滅之刃: ['鬼灭之刃', '鬼滅', 'Demon Slayer'],
    咒术回战: ['咒術迴戰', '咒术', 'Jujutsu Kaisen'],
    咒術迴戰: ['咒术回战', '咒術', 'Jujutsu Kaisen'],
    火影忍者: ['火影', '疾风传', '疾風傳', 'Naruto'],
    间谍过家家: ['間諜家家酒', 'Spy x Family'],
    間諜家家酒: ['间谍过家家', 'Spy x Family'],
    尖帽子的魔法工房: [
      '尖帽子的魔法工坊',
      '尖帽子魔法工房',
      '尖帽子魔法工坊',
      'とんがり帽子のアトリエ',
      'Witch Hat Atelier',
      'Tongari Boushi no Atelier',
    ],
    尖帽子的魔法工坊: [
      '尖帽子的魔法工房',
      '尖帽子魔法工房',
      '尖帽子魔法工坊',
      'とんがり帽子のアトリエ',
      'Witch Hat Atelier',
      'Tongari Boushi no Atelier',
    ],
    とんがり帽子のアトリエ: [
      '尖帽子的魔法工房',
      '尖帽子的魔法工坊',
      '尖帽子魔法工房',
      '尖帽子魔法工坊',
      'Witch Hat Atelier',
      'Tongari Boushi no Atelier',
    ],
    猎人: ['全职猎人', '全職獵人', 'Hunter x Hunter'],
    全职猎人: ['猎人', 'Hunter x Hunter'],
    全職獵人: ['獵人', 'Hunter x Hunter'],
    速度与激情: [
      '速度與激情',
      '玩命關頭',
      '玩命关头',
      'Fast and Furious',
      'Fast & Furious',
    ],
    速度與激情: [
      '速度与激情',
      '玩命關頭',
      '玩命关头',
      'Fast and Furious',
      'Fast & Furious',
    ],
    玩命關頭: [
      '速度与激情',
      '速度與激情',
      '玩命关头',
      'Fast and Furious',
      'Fast & Furious',
    ],
    玩命关头: [
      '速度与激情',
      '速度與激情',
      '玩命關頭',
      'Fast and Furious',
      'Fast & Furious',
    ],
    王牌特工: ['金牌特務', '金牌特务', 'Kingsman'],
    金牌特務: ['王牌特工', '金牌特务', 'Kingsman'],
    金牌特务: ['王牌特工', '金牌特務', 'Kingsman'],
    黑客帝国: ['駭客任務', '骇客任务', 'The Matrix'],
    駭客任務: ['黑客帝国', '骇客任务', 'The Matrix'],
    骇客任务: ['黑客帝国', '駭客任務', 'The Matrix'],
    盗梦空间: ['全面啟動', '全面启动', 'Inception'],
    全面啟動: ['盗梦空间', '全面启动', 'Inception'],
    全面启动: ['盗梦空间', '全面啟動', 'Inception'],
    星际穿越: ['星際效應', '星际效应', 'Interstellar'],
    星際效應: ['星际穿越', '星际效应', 'Interstellar'],
    星际效应: ['星际穿越', '星際效應', 'Interstellar'],
    加勒比海盗: ['神鬼奇航', 'Pirates of the Caribbean'],
    神鬼奇航: ['加勒比海盗', 'Pirates of the Caribbean'],
    明日边缘: ['明日邊界', '明日边界', 'Edge of Tomorrow'],
    明日邊界: ['明日边缘', '明日边界', 'Edge of Tomorrow'],
    明日边界: ['明日边缘', '明日邊界', 'Edge of Tomorrow'],
    肖申克的救赎: ['刺激1995', '肖申克的救贖', 'The Shawshank Redemption'],
    肖申克的救贖: ['刺激1995', '肖申克的救赎', 'The Shawshank Redemption'],
    刺激1995: ['肖申克的救赎', '肖申克的救贖', 'The Shawshank Redemption'],
    三傻大闹宝莱坞: ['三個傻瓜', '三个傻瓜', '三傻大鬧寶萊塢', '3 Idiots'],
    三傻大鬧寶萊塢: ['三個傻瓜', '三个傻瓜', '三傻大闹宝莱坞', '3 Idiots'],
    三個傻瓜: ['三个傻瓜', '三傻大闹宝莱坞', '三傻大鬧寶萊塢', '3 Idiots'],
    三个傻瓜: ['三個傻瓜', '三傻大闹宝莱坞', '三傻大鬧寶萊塢', '3 Idiots'],
    摔跤吧爸爸: [
      '我和我的冠軍女兒',
      '我和我的冠军女儿',
      '摔跤吧！爸爸',
      '摔跤吧爸爸',
      'Dangal',
    ],
    我和我的冠軍女兒: [
      '我和我的冠军女儿',
      '摔跤吧！爸爸',
      '摔跤吧爸爸',
      'Dangal',
    ],
    我和我的冠军女儿: [
      '我和我的冠軍女兒',
      '摔跤吧！爸爸',
      '摔跤吧爸爸',
      'Dangal',
    ],
    头脑特工队: ['腦筋急轉彎', '頭腦特工隊', 'Inside Out'],
    頭腦特工隊: ['腦筋急轉彎', '头脑特工队', 'Inside Out'],
    腦筋急轉彎: ['头脑特工队', '頭腦特工隊', 'Inside Out'],
    疯狂动物城: ['動物方城市', '瘋狂動物城', 'Zootopia'],
    瘋狂動物城: ['動物方城市', '疯狂动物城', 'Zootopia'],
    動物方城市: ['疯狂动物城', '瘋狂動物城', 'Zootopia'],
    寻梦环游记: ['COCO夜總會', '尋夢環遊記', 'Coco'],
    尋夢環遊記: ['COCO夜總會', '寻梦环游记', 'Coco'],
    COCO夜總會: ['尋夢環遊記', '寻梦环游记', 'Coco'],
    生化危机: ['惡靈古堡', '生化危機', 'Resident Evil'],
    生化危機: ['惡靈古堡', '生化危机', 'Resident Evil'],
    惡靈古堡: ['生化危机', '生化危機', 'Resident Evil'],
    泰坦尼克号: ['鐵達尼號', '泰坦尼克號', 'Titanic'],
    泰坦尼克號: ['鐵達尼號', '泰坦尼克号', 'Titanic'],
    鐵達尼號: ['泰坦尼克号', '泰坦尼克號', 'Titanic'],
    疾速追杀: ['捍衛任務', '極速追殺', 'John Wick'],
    極速追殺: ['捍衛任務', '疾速追杀', 'John Wick'],
    捍衛任務: ['疾速追杀', '極速追殺', 'John Wick'],
    电锯人: ['鏈鋸人', '電鋸人', 'Chainsaw Man'],
    電鋸人: ['鏈鋸人', '电锯人', 'Chainsaw Man'],
    鏈鋸人: ['电锯人', '電鋸人', 'Chainsaw Man'],
    千与千寻: ['神隱少女', '千與千尋', 'Spirited Away'],
    千與千尋: ['神隱少女', '千与千寻', 'Spirited Away'],
    神隱少女: ['千与千寻', '千與千尋', 'Spirited Away'],
  };

  // 嘗試匹配別名
  for (const [key, aliases] of Object.entries(ALIAS_MAP)) {
    if (
      Array.from(aliasMatchCandidates).some((candidate) =>
        candidate.includes(key)
      )
    ) {
      aliases.forEach((alias) => {
        if (isCjkSearchQuery(alias)) variants.add(alias);
      });
    }
  }

  // 提取核心關鍵字（對於太長的標題，API 容易找不到，可以嘗試提取核心名詞）
  if (
    Array.from(aliasMatchCandidates).some(
      (candidate) => candidate.includes('风纪委员') && candidate.includes('JK')
    )
  ) {
    variants.add('风纪委员');
  }

  return Array.from(variants).filter(
    (variant) => variant === trimmed || isCjkSearchQuery(variant)
  );
}
function buildConversionMap(): Record<string, string> {
  return {
    电: '電',
    剧: '劇',
    结: '結',
    无: '無',
    场: '場',
    学: '學',
    会: '會',
    开: '開',
    关: '關',
    听: '聽',
    说: '說',
    读: '讀',
    写: '寫',
    设: '設',
    计: '計',
    认: '認',
    识: '識',
    问: '問',
    时: '時',
    间: '間',
    东: '東',
    南: '南',
    北: '北',
    里: '裡',
    历: '歷',
    现: '現',
    在: '在',
    这: '這',
    那: '那',
    为: '為',
    什: '什',
    么: '麼',
    没: '沒',
    有: '有',
    来: '來',
    去: '去',
    好: '好',
    看: '看',
    做: '做',
    对: '對',
    于: '於',
    上: '上',
    下: '下',
    中: '中',
    大: '大',
    小: '小',
    多: '多',
    少: '少',
    年: '年',
    月: '月',
    日: '日',
    分: '分',
    秒: '秒',
    号: '號',
    表: '表',
    示: '示',
    显: '顯',
    器: '器',
    音: '音',
    乐: '樂',
    视: '視',
    频: '頻',
    播: '播',
    放: '放',
    影: '影',
    片: '片',
    内: '內',
    容: '容',
    搜: '搜',
    索: '索',
    引: '引',
    擎: '擎',
    页: '頁',
    面: '面',
    网: '網',
    络: '絡',
    连: '連',
    接: '接',
    错: '錯',
    误: '誤',
    请: '請',
    求: '求',
    需: '需',
    要: '要',
    新: '新',
    旧: '舊',
    快: '快',
    慢: '慢',
    高: '高',
    低: '低',
    长: '長',
    短: '短',
    宽: '寬',
    窄: '窄',
    远: '遠',
    近: '近',
    难: '難',
    易: '易',
    继续: '繼續',
    发: '發',
    布: '布',
    收: '收',
    藏: '藏',
    夹: '夾',
    消息: '消息',
    通知: '通知',
    朋友: '朋友',
    资料: '資料',
    资源: '資源',
    國産: '國產',
    国产: '國產',
    登录: '登入',
    注册: '註冊',
    密码: '密碼',
    用户: '使用者',
    账号: '帳號',
    賬號: '帳號',
    支持: '支援',
    名称: '名稱',
    功能: '功能',
    设置: '設定',
    选项: '選項',
    帮助: '說明',
    关于: '關於',
    版本: '版本',
    更新: '更新',
    检查: '檢查',
    失败: '失敗',
    成功: '成功',
    完成: '完成',
    加载: '載入',
    保存: '儲存',
    删除: '刪除',
    编辑: '編輯',
    取消: '取消',
    确认: '確認',
    返回: '返回',
    关闭: '關閉',
    打开: '開啟',
    启动: '啟動',
    停止: '停止',
    运行: '運行',
    测试: '測試',
    调试: '調試',
    错误: '錯誤',
    警告: '警告',
    信息: '資訊',
    记录: '記錄',
    日志: '日誌',
    数据: '數據',
    文件: '檔案',
    图片: '圖片',
    视频: '影片',
    文档: '文檔',
    管理: '管理',
    系统: '系統',
    服务器: '伺服器',
    客户端: '使用者端',
    网络: '網路',
    地址: '位址',
    端口: '連接埠',
    协议: '協定',
    服务: '服務',
    进程: '進程',
    线程: '執行緒',
    内存: '記憶體',
    磁盘: '磁碟',
    空间: '空間',
    速度: '速度',
    性能: '效能',
    优化: '優化',
    处理: '處理',
    操作: '操作',
    方式: '方式',
    类型: '類型',
    格式: '格式',
    状态: '狀態',
    结果: '結果',
    原因: '原因',
    方法: '方法',
    内容: '內容',
    标题: '標題',
    简介: '簡介',
    描述: '描述',
    分类: '分類',
    标签: '標籤',
    排序: '排序',
    筛选: '篩選',
    查询: '查詢',
    浏览: '瀏覽',
    观看: '觀看',
    下载: '下載',
    上传: '上傳',
    同步: '同步',
    导入: '匯入',
    导出: '匯出',
    备份: '備份',
    恢复: '恢復',
    迁移: '移轉',
    转换: '轉換',
    编码: '編碼',
    解码: '解碼',
    加密: '加密',
    解密: '解密',
    验证: '驗證',
    授权: '授權',
    权限: '權限',
    角色: '角色',
    组: '群組',
    组织: '組織',
    认证: '認證',
    登出: '登出',
    激活: '啟用',
    停用: '停用',
    访问: '存取',
    控制: '控制',
    监控: '監控',
    报告: '報告',
    统计: '統計',
    分析: '分析',
    计划: '計劃',
    调度: '調度',
    任务: '任務',
    队列: '佇列',
    缓存: '快取',
    代理: '代理',
    路由: '路由',
    转发: '轉發',
    负载: '負載',
    均衡: '均衡',
    集群: '叢集',
    节点: '節點',
    主: '主',
    从: '從',
    备: '備',
    故障: '故障',
    转移: '轉移',
    升级: '升級',
    降级: '降級',
    回滚: '復原',
    部署: '部署',
    回退: '回退',
  };
}

const SIMPLIFIED_TO_TRADITIONAL = buildConversionMap();
const SORTED_SIMPLIFIED_TO_TRADITIONAL = Object.entries(
  SIMPLIFIED_TO_TRADITIONAL
).sort((a, b) => b[0].length - a[0].length);

/**
 * 名稱以 🎬 開頭的片源（如「🎬iKun资源」「🎬某某资源」）一律維持上游原文：
 * 不做繁簡轉換、不改台灣用語、不動符號與 emoji。
 * 其餘片源名稱仍走 toDisplayLanguage。
 */
export function shouldPreserveSourceDisplayName(name: string): boolean {
  return /^\s*🎬/.test(name);
}

export function toDisplayLanguage(text: string): string {
  // 🎬 前綴片源：簡體就是簡體，符號也不能動
  if (shouldPreserveSourceDisplayName(text)) {
    return text;
  }
  let result = text;
  for (const [simp, trad] of SORTED_SIMPLIFIED_TO_TRADITIONAL) {
    result = result.split(simp).join(trad);
  }
  return convertS2T(result);
}

export function cleanQueryForApi(rawQuery: string): string {
  if (!rawQuery) return rawQuery;

  let k = rawQuery.trim();

  // 1. 移除括號及括號內的修飾詞（如「(第一季)」「（僅限）」）
  //    保留短內容（≤3字且不含季數標記），避免誤刪標題本體（如「鉴定士(伪)」）
  k = k
    .replace(
      /\s*[（(]([^）)]*)[）)]\s*/g,
      (_match: string, content: string) => {
        const trimmed = content.trim();
        // 保留短標題內文（≤3字且不含季/部/集等元數據關鍵字）
        if (
          trimmed.length <= 3 &&
          !/[第季部話话集期\d]/.test(trimmed) &&
          !/^(僅限|限定|未删减?|删减|无修|有修|中字|字幕|高清|超清|蓝光|藍光|繁中|简中|简体|繁體)$/.test(
            trimmed
          )
        ) {
          return '(' + trimmed + ')';
        }
        return '';
      }
    )
    .trim();

  // 1.5 移除中括號及中括號內的修飾詞（如「【第一季】」「[1080P]」等）
  k = k
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();

  // 2. 日文助詞轉換：將常見日文助詞轉為中文（讓「進擊の巨人」可搜到「進擊的巨人」）
  k = k
    .replace(/の/g, '的')
    .replace(/は/g, '')
    .replace(/を/g, '')
    .replace(/と/g, '和');

  // 3. 移除結尾的常見干擾後綴（季、期、部、版等）
  k = k
    .replace(
      /([\s\u3000]*(?:第[一二三四五六七八九十\d]+(?:季|期|部(?!分)|部分|話|话|集)|Season\s*\d+|Part\s*\d+|S\d+|動畫版|动画版|真人版|劇場版|剧场版|的故事))+$/gi,
      ''
    )
    .trim();

  // 4. 清除頭尾的標點符號和多餘空格
  k = k.replace(/^[\s\-_,.：，。！？]+|[\s\-_,.：，。！？]+$/g, '').trim();

  return k || rawQuery.trim();
}
