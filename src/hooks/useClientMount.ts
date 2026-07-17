import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => undefined;

/**
 * SSR-safe 掛載旗標：hydration 首輪為 false，掛載後為 true。
 * 取代「useState(false) + useEffect(() => setMounted(true), [])」，
 * 語義相同（伺服器快照 false、客戶端快照 true），且符合
 * react-hooks/set-state-in-effect 規則。
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

/**
 * SSR-safe 讀取瀏覽器端靜態值（window.RUNTIME_CONFIG、localStorage 等）。
 * 伺服器/hydration 首輪回傳 serverValue，掛載後回傳 read() 結果。
 *
 * 注意：read 會在每次 render 被呼叫，必須回傳原始型別或穩定參考
 * （例如直接回傳 RUNTIME_CONFIG 上的同一個物件），否則會無限重渲染。
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(emptySubscribe, read, () => serverValue);
}
