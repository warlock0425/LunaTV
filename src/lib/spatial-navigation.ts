/**
 * 遙控器（D-pad）空間導航的純邏輯。
 *
 * 電視遙控器送出的是方向鍵，而瀏覽器原生只會用 Tab 依 DOM 順序移動焦點，
 * 按上下左右不會有任何反應——這是本專案在電視上無法操作的唯一原因
 * （實測 1920x1080 下所有可聚焦元素都能到達、也都有聚焦外框，就只差方向鍵）。
 *
 * 這裡不依賴 DOM API 以外的東西，並把「選誰」抽成純函式，方便單元測試。
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

/** 參與導航的元素幾何資訊 */
export interface NavRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NavCandidate<T = unknown> {
  ref: T;
  rect: NavRect;
}

/**
 * 跨軸未對齊的懲罰權重。
 *
 * 電視上的版面多為卡片網格，使用者按「右」時期待的是同一列的下一張，
 * 而不是斜下方距離較近的那張。放大跨軸差距的權重可以讓移動符合直覺。
 */
const CROSS_AXIS_PENALTY = 3;

/** 邊界比較的容差，避免像素級誤差讓同排元素被誤判為不同排 */
const EDGE_TOLERANCE = 1;

function centerOf(rect: NavRect) {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

/** 兩個區間的重疊長度（用來判斷是否「同一列／同一行」） */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

/**
 * 判斷候選是否位於指定方向；回傳主軸距離，不在該方向則回傳 null。
 */
function primaryDistance(
  dir: Direction,
  from: NavRect,
  to: NavRect
): number | null {
  switch (dir) {
    case 'right': {
      const d = to.left - from.right;
      return d >= -EDGE_TOLERANCE ? Math.max(d, 0) : null;
    }
    case 'left': {
      const d = from.left - to.right;
      return d >= -EDGE_TOLERANCE ? Math.max(d, 0) : null;
    }
    case 'down': {
      const d = to.top - from.bottom;
      return d >= -EDGE_TOLERANCE ? Math.max(d, 0) : null;
    }
    case 'up': {
      const d = from.top - to.bottom;
      return d >= -EDGE_TOLERANCE ? Math.max(d, 0) : null;
    }
  }
}

/** 跨軸的偏移量與重疊狀況 */
function crossAxis(dir: Direction, from: NavRect, to: NavRect) {
  const horizontal = dir === 'left' || dir === 'right';
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  if (horizontal) {
    return {
      offset: Math.abs(fromCenter.y - toCenter.y),
      overlaps: overlap(from.top, from.bottom, to.top, to.bottom) > 0,
    };
  }
  return {
    offset: Math.abs(fromCenter.x - toCenter.x),
    overlaps: overlap(from.left, from.right, to.left, to.right) > 0,
  };
}

/**
 * 從候選中選出指定方向最合適的一個。
 *
 * 規則：
 * 1. 只考慮確實位於該方向的候選；
 * 2. 主軸距離越近越好，跨軸偏移以較高權重懲罰（讓同列／同行優先）；
 * 3. 跨軸有重疊者（視覺上同一列／同一行）永遠優先於沒有重疊者，
 *    避免按「右」卻跳到下一排開頭。
 */
export function pickNextCandidate<T>(
  dir: Direction,
  current: NavRect,
  candidates: NavCandidate<T>[]
): NavCandidate<T> | null {
  let best: NavCandidate<T> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAligned = false;

  for (const candidate of candidates) {
    const primary = primaryDistance(dir, current, candidate.rect);
    if (primary === null) continue;

    const { offset, overlaps } = crossAxis(dir, current, candidate.rect);
    const score = primary + offset * CROSS_AXIS_PENALTY;

    // 同列／同行優先：只有在目前最佳解也非同列時，非同列的候選才有機會勝出
    if (bestAligned && !overlaps) continue;
    const beatsBest = overlaps && !bestAligned ? true : score < bestScore;
    if (!beatsBest) continue;

    best = candidate;
    bestScore = score;
    bestAligned = overlaps;
  }

  return best;
}

/**
 * 沒有任何焦點時的起點：選最接近畫面左上、且在可視範圍內的候選。
 * 電視開機進站時沒有焦點，第一次按方向鍵要有明確的落點。
 */
export function pickInitialCandidate<T>(
  candidates: NavCandidate<T>[],
  viewportHeight: number
): NavCandidate<T> | null {
  let best: NavCandidate<T> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const { top, left, bottom } = candidate.rect;
    if (bottom <= 0 || top >= viewportHeight) continue; // 不在可視範圍
    const score = top * 2 + left; // 由上而下、由左至右
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

/** 方向鍵事件對應的方向；非方向鍵回傳 null */
export function directionFromKey(key: string): Direction | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

export interface ActiveElementState {
  tagName: string;
  type: string | null;
  isContentEditable: boolean;
  /** 單行輸入框的游標位置與長度；取不到時為 null */
  selectionStart: number | null;
  selectionEnd: number | null;
  valueLength: number;
}

/**
 * 是否應該把方向鍵讓給元素自己處理。
 *
 * 關鍵在於單行輸入框：若無條件讓出，使用者在電視上只要焦點掉進搜尋框就
 * 再也出不來（實測確認過這個死路）。因此：
 * - 上／下：單行輸入沒有垂直移動的語意，一律讓導航帶走；
 * - 左／右：游標還能在文字內移動時讓給輸入框，已在頭／尾則放行離開。
 *
 * textarea 與 contentEditable 需要上下移動游標，維持完全讓出。
 */
export function shouldYieldToElement(
  dir: Direction,
  state: ActiveElementState
): boolean {
  if (state.isContentEditable) return true;

  const tag = state.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;

  const type = (state.type || 'text').toLowerCase();
  if (['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)) {
    return false;
  }

  // 單行輸入：上下一律放行，讓使用者能離開輸入框
  if (dir === 'up' || dir === 'down') return false;

  const { selectionStart, selectionEnd, valueLength } = state;
  // 取不到游標位置（例如 type=number）時保守讓出，避免無法編輯
  if (selectionStart === null || selectionEnd === null) return true;

  // 有選取範圍時交給輸入框處理
  if (selectionStart !== selectionEnd) return true;

  if (dir === 'left') return selectionStart > 0;
  return selectionEnd < valueLength;
}
