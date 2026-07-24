/**
 * 使用者名冊的調和邏輯（純函式，供 redis-base 與 upstash 共用）。
 *
 * 上游作者的 getAllUsers 直接掃 u:*:pwd 密碼鍵，因此「能登入的帳號一定會被
 * cron 集數更新掃到」。本 fork 改用 sys:users 索引 Set 後，索引有多條漏登記
 * 路徑：一次性遷移旗標鎖死重建、備份匯入在部分後端靜默跳過 sAdd 等。漏掉的
 * 帳號能登入、後台看得到，但 cron 永遠略過——症狀即「站長會更新、其他人不會」
 * （站長是 cron 額外 push 進名單的，不吃索引）。
 *
 * 因此以密碼鍵為最終真相：索引只是快取，讀取時比對補齊。
 */

const USER_PWD_KEY_PATTERN = /^u:(.+?):pwd$/;

export interface ReconciledUserIndex {
  /** 完整名冊（索引 ∪ 密碼鍵持有者，已去重） */
  users: string[];
  /** 有密碼鍵但不在索引裡的帳號，呼叫端應補寫回索引 Set */
  missing: string[];
}

export function reconcileUserIndex(
  indexMembers: readonly string[],
  pwdKeys: readonly string[]
): ReconciledUserIndex {
  const fromKeys: string[] = [];
  for (const key of pwdKeys) {
    const match = key.match(USER_PWD_KEY_PATTERN);
    if (match?.[1]) fromKeys.push(match[1]);
  }

  const indexSet = new Set(indexMembers);
  const missing = Array.from(
    new Set(fromKeys.filter((user) => !indexSet.has(user)))
  );
  const users = Array.from(new Set([...indexMembers, ...fromKeys]));
  return { users, missing };
}
