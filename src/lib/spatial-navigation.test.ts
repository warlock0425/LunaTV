import {
  directionFromKey,
  NavCandidate,
  NavRect,
  pickInitialCandidate,
  pickNextCandidate,
  shouldYieldToElement,
} from './spatial-navigation';

/** 以 (x, y, w, h) 建立矩形，方便描述版面 */
function rect(x: number, y: number, w = 100, h = 60): NavRect {
  return { left: x, top: y, right: x + w, bottom: y + h };
}

function cand(name: string, x: number, y: number, w = 100, h = 60) {
  return { ref: name, rect: rect(x, y, w, h) } as NavCandidate<string>;
}

describe('pickNextCandidate', () => {
  /**
   * 模擬電視上最常見的版面：卡片網格。
   *   A  B  C
   *   D  E  F
   */
  const grid = [
    cand('A', 0, 0),
    cand('B', 120, 0),
    cand('C', 240, 0),
    cand('D', 0, 80),
    cand('E', 120, 80),
    cand('F', 240, 80),
  ];

  it('向右移到同一列的下一張，而不是斜下方', () => {
    expect(pickNextCandidate('right', rect(0, 0), grid)?.ref).toBe('B');
  });

  it('向左移到同一列的上一張', () => {
    expect(pickNextCandidate('left', rect(240, 0), grid)?.ref).toBe('B');
  });

  it('向下移到同一行的下一張', () => {
    expect(pickNextCandidate('down', rect(120, 0), grid)?.ref).toBe('E');
  });

  it('向上移到同一行的上一張', () => {
    expect(pickNextCandidate('up', rect(120, 80), grid)?.ref).toBe('B');
  });

  it('已在該方向邊界時回傳 null（焦點不亂跳）', () => {
    expect(pickNextCandidate('up', rect(0, 0), grid)).toBeNull();
    expect(pickNextCandidate('left', rect(0, 0), grid)).toBeNull();
    expect(pickNextCandidate('right', rect(240, 80), grid)).toBeNull();
    expect(pickNextCandidate('down', rect(240, 80), grid)).toBeNull();
  });

  it('同列優先於距離更近但不同列的候選', () => {
    // 右方同列有一個較遠的，右下方有一個較近的；應選同列那個
    const items = [cand('sameRow', 400, 0), cand('closerButBelow', 130, 200)];
    expect(pickNextCandidate('right', rect(0, 0), items)?.ref).toBe('sameRow');
  });

  it('同列沒有候選時，才退而求其次選鄰近排的', () => {
    const items = [cand('nextRow', 130, 200)];
    expect(pickNextCandidate('right', rect(0, 0), items)?.ref).toBe('nextRow');
  });

  it('忽略自己（不會原地不動）', () => {
    const self = cand('self', 0, 0);
    expect(pickNextCandidate('right', self.rect, [self])).toBeNull();
  });

  it('候選為空時回傳 null', () => {
    expect(pickNextCandidate('down', rect(0, 0), [])).toBeNull();
  });

  it('側邊欄→內容區：從左側細長項目往右可進入內容', () => {
    // 側邊欄項目較窄較高，內容卡片在右側
    const items = [cand('card', 200, 10, 160, 240)];
    expect(pickNextCandidate('right', rect(0, 0, 80, 60), items)?.ref).toBe(
      'card'
    );
  });
});

describe('pickInitialCandidate', () => {
  it('選畫面內最左上的元素作為起點', () => {
    const items = [
      cand('middle', 300, 300),
      cand('topLeft', 10, 10),
      cand('topRight', 500, 10),
    ];
    expect(pickInitialCandidate(items, 1080)?.ref).toBe('topLeft');
  });

  it('略過捲動到畫面外的元素', () => {
    const items = [
      cand('offscreenAbove', 0, -500),
      cand('visible', 50, 100),
      cand('offscreenBelow', 0, 5000),
    ];
    expect(pickInitialCandidate(items, 1080)?.ref).toBe('visible');
  });

  it('全部都在畫面外時回傳 null', () => {
    expect(pickInitialCandidate([cand('x', 0, 5000)], 1080)).toBeNull();
  });
});

describe('directionFromKey', () => {
  it('對應四個方向鍵', () => {
    expect(directionFromKey('ArrowUp')).toBe('up');
    expect(directionFromKey('ArrowDown')).toBe('down');
    expect(directionFromKey('ArrowLeft')).toBe('left');
    expect(directionFromKey('ArrowRight')).toBe('right');
  });

  it('其他按鍵回傳 null（不干擾一般輸入）', () => {
    expect(directionFromKey('Enter')).toBeNull();
    expect(directionFromKey('a')).toBeNull();
    expect(directionFromKey('Tab')).toBeNull();
  });
});

describe('shouldYieldToElement', () => {
  const input = (over = {}) => ({
    tagName: 'INPUT',
    type: 'text',
    isContentEditable: false,
    selectionStart: 0,
    selectionEnd: 0,
    valueLength: 0,
    ...over,
  });

  it('textarea 與 contentEditable 完全讓出（需要上下移動游標）', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      expect(shouldYieldToElement(dir, input({ tagName: 'TEXTAREA' }))).toBe(
        true
      );
      expect(
        shouldYieldToElement(
          dir,
          input({ tagName: 'DIV', isContentEditable: true })
        )
      ).toBe(true);
    }
  });

  it('單行輸入按上下一律放行（否則焦點會困在搜尋框裡出不來）', () => {
    const mid = input({ valueLength: 10, selectionStart: 5, selectionEnd: 5 });
    expect(shouldYieldToElement('up', mid)).toBe(false);
    expect(shouldYieldToElement('down', mid)).toBe(false);
  });

  it('單行輸入的左右鍵在文字內讓給游標', () => {
    const mid = input({ valueLength: 10, selectionStart: 5, selectionEnd: 5 });
    expect(shouldYieldToElement('left', mid)).toBe(true);
    expect(shouldYieldToElement('right', mid)).toBe(true);
  });

  it('游標在開頭按左、在結尾按右時放行離開', () => {
    const atStart = input({
      valueLength: 10,
      selectionStart: 0,
      selectionEnd: 0,
    });
    expect(shouldYieldToElement('left', atStart)).toBe(false);
    expect(shouldYieldToElement('right', atStart)).toBe(true);

    const atEnd = input({
      valueLength: 10,
      selectionStart: 10,
      selectionEnd: 10,
    });
    expect(shouldYieldToElement('right', atEnd)).toBe(false);
    expect(shouldYieldToElement('left', atEnd)).toBe(true);
  });

  it('空輸入框左右皆可離開', () => {
    const empty = input({ valueLength: 0, selectionStart: 0, selectionEnd: 0 });
    expect(shouldYieldToElement('left', empty)).toBe(false);
    expect(shouldYieldToElement('right', empty)).toBe(false);
  });

  it('有選取範圍時交給輸入框', () => {
    const sel = input({ valueLength: 10, selectionStart: 2, selectionEnd: 6 });
    expect(shouldYieldToElement('left', sel)).toBe(true);
    expect(shouldYieldToElement('right', sel)).toBe(true);
  });

  it('讀不到游標位置時保守讓出（避免無法編輯）', () => {
    const unknown = input({ selectionStart: null, selectionEnd: null });
    expect(shouldYieldToElement('left', unknown)).toBe(true);
  });

  it('不需要方向鍵的控制項交給導航', () => {
    expect(shouldYieldToElement('right', input({ type: 'checkbox' }))).toBe(
      false
    );
    expect(shouldYieldToElement('right', input({ type: 'radio' }))).toBe(false);
    expect(shouldYieldToElement('right', input({ tagName: 'BUTTON' }))).toBe(
      false
    );
    expect(shouldYieldToElement('right', input({ tagName: 'A' }))).toBe(false);
  });
});
