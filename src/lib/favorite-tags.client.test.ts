import {
  getAllItemTags,
  getFavoriteTags,
  saveFavoriteTags,
  setItemTags,
} from './favorite-tags.client';

const DEFINITIONS_KEY = 'moontv_favorite_tags_definitions';
const ITEMS_KEY = 'moontv_favorite_tags_items';

/**
 * 這些資料全部存在 localStorage，隨時可能被使用者、擴充功能或舊版本寫壞。
 * setItemTags 原本直接 JSON.parse 而沒有 try/catch（兩個兄弟函式都有），
 * 資料一毀損，點擊標籤就會在事件處理器裡拋錯，呼叫端後續的 setState 也不會執行。
 */
describe('favorite-tags.client 對毀損資料的容忍度', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('setItemTags', () => {
    it('既有資料毀損時不拋錯，並以新資料重建', () => {
      localStorage.setItem(ITEMS_KEY, '{"broken":');

      expect(() => setItemTags('src+1', ['想看'])).not.toThrow();
      expect(getAllItemTags()).toEqual({ 'src+1': ['想看'] });
    });

    it('既有資料是陣列（型別錯誤）時不拋錯', () => {
      localStorage.setItem(ITEMS_KEY, '[1,2,3]');

      expect(() => setItemTags('src+1', ['想看'])).not.toThrow();
      expect(getAllItemTags()).toEqual({ 'src+1': ['想看'] });
    });

    it('保留其他項目的標籤', () => {
      setItemTags('src+1', ['想看']);
      setItemTags('src+2', ['已看']);

      expect(getAllItemTags()).toEqual({
        'src+1': ['想看'],
        'src+2': ['已看'],
      });
    });
  });

  describe('getAllItemTags', () => {
    it('過濾掉非陣列的值，避免呼叫端 .includes/.filter 拋錯', () => {
      localStorage.setItem(
        ITEMS_KEY,
        JSON.stringify({
          good: ['想看'],
          notArray: 'oops',
          nested: { a: 1 },
          mixed: ['ok', 123, null],
        })
      );

      expect(getAllItemTags()).toEqual({
        good: ['想看'],
        mixed: ['ok'],
      });
    });

    it('毀損或缺漏時回傳空物件', () => {
      expect(getAllItemTags()).toEqual({});
      localStorage.setItem(ITEMS_KEY, 'not json');
      expect(getAllItemTags()).toEqual({});
    });
  });

  describe('getFavoriteTags', () => {
    it('儲存值不是陣列時回傳空陣列', () => {
      localStorage.setItem(DEFINITIONS_KEY, '{"not":"an array"}');
      expect(getFavoriteTags()).toEqual([]);
    });

    it('正常往返', () => {
      saveFavoriteTags([{ name: '想看', color: 'red' }]);
      expect(getFavoriteTags()).toEqual([{ name: '想看', color: 'red' }]);
    });
  });

  it('localStorage 寫入失敗（配額不足）不會中斷 UI 操作', () => {
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });

    expect(() => setItemTags('src+1', ['想看'])).not.toThrow();
    expect(() => saveFavoriteTags([{ name: 'x', color: 'red' }])).not.toThrow();

    setItem.mockRestore();
  });
});
