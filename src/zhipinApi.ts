import type { Page } from "playwright";
import type { FriendListItem, PatrolConfig } from "./types.js";

export function displayName(item: FriendListItem): string | undefined {
  const gu = item.formUser as { userName?: string } | undefined;
  return item.geekName || item.name || gu?.userName;
}

function numPositive(v: unknown): boolean {
  return typeof v === "number" && v > 0;
}

/** 招聘端/接口字段差异较大，尽量从常见字段推断未读 */
export function isLikelyUnread(item: FriendListItem): boolean {
  // Boss 招聘端常见：newGeek=1 表示新候选人/新会话，通常对应未读待处理。
  if ((item as Record<string, unknown>).newGeek === 1 || (item as Record<string, unknown>).newGeek === true) {
    return true;
  }

  const rootNums = [
    item.unreadMsgCount,
    item.unreadCount,
    item.unreadMidMsgCount,
    item.hiCardUnRead as number | undefined,
    item.badgeNum as number | undefined,
    item.msgUnreadCount as number | undefined,
  ];
  for (const n of rootNums) {
    if (numPositive(n)) return true;
  }
  if (item.unread === 1 || item.unread === true) return true;
  if (numPositive(item.unread)) return true;

  const lm = item.lastMessageInfo;
  if (lm && typeof lm === "object") {
    const o = lm as Record<string, unknown>;
    const u = o.unreadCount ?? o.unreadMsgCount ?? o.unread ?? o.unReadCount;
    if (numPositive(u)) return true;
    if (u === true || u === 1) return true;
  }

  const any = item as Record<string, unknown>;
  for (const k of Object.keys(any)) {
    if (!/unread|badge|未读|newMsg|newChat/i.test(k)) continue;
    const v = any[k];
    if (numPositive(v) || v === true) return true;
  }
  return false;
}

export type FriendListProbeRow = {
  url: string;
  httpStatus: number;
  code?: number;
  message?: string;
  arrayLen: number;
  zpDataKeys: string[];
  error?: string;
};

export async function fetchFriendListInPage(
  page: Page,
  candidates: string[],
): Promise<{ usedUrl: string; items: FriendListItem[] } | null> {
  const { result } = await fetchFriendListInPageWithProbe(page, candidates);
  return result;
}

/** 对每个候选 URL 探测 HTTP/json；设置 BOSS_DEBUG_FRIEND=1 可在日志里看 probe。 */
export async function fetchFriendListInPageWithProbe(
  page: Page,
  candidates: string[],
): Promise<{ result: { usedUrl: string; items: FriendListItem[] } | null; probe: FriendListProbeRow[] }> {
  const { probe, result } = await page.evaluate(async (urls: string[]) => {
    type Row = {
      url: string;
      httpStatus: number;
      code?: number;
      message?: string;
      arrayLen: number;
      zpDataKeys: string[];
      error?: string;
    };
    const probe: Row[] = [];
    let result: { usedUrl: string; items: FriendListItem[] } | null = null;
    for (const url of urls) {
      const row: Row = { url, httpStatus: 0, arrayLen: 0, zpDataKeys: [] };
      try {
        const r = await fetch(url, { credentials: "include" });
        row.httpStatus = r.status;
        const j = (await r.json()) as {
          code?: number;
          message?: string;
          zpData?: unknown;
        };
        row.code = j.code;
        row.message = typeof j.message === "string" ? j.message : undefined;
        const zp = j.zpData;
        let arr: FriendListItem[] | undefined;
        if (Array.isArray(zp)) {
          arr = zp as FriendListItem[];
          row.zpDataKeys = [`<array:${arr.length}>`];
        } else if (zp && typeof zp === "object") {
          const o = zp as Record<string, unknown>;
          row.zpDataKeys = Object.keys(o).slice(0, 30);
          arr =
            (o.result as FriendListItem[] | undefined) ??
            (o.data as FriendListItem[] | undefined) ??
            (o.friendList as FriendListItem[] | undefined) ??
            (o.list as FriendListItem[] | undefined);
        }
        if (Array.isArray(arr)) {
          row.arrayLen = arr.length;
          if (j.code === 0 && arr.length > 0 && !result) {
            result = { usedUrl: url, items: arr };
          }
        }
      } catch (e) {
        row.error = (e as Error).message;
      }
      probe.push(row);
    }
    return { probe, result };
  }, candidates);
  return { result, probe };
}

export async function listUnreadDisplayHintsFromDom(page: Page, config: PatrolConfig): Promise<string[]> {
  const sel = config.selectors.sidebarUserItem;
  return page
    .evaluate((selector) => {
      const selectors = [
        selector,
        ".user-list .user-item",
        ".chat-user-list .item",
        ".friend-list .item",
        "[class*='chat-list'] [class*='item']",
        "[class*='session'] [class*='item']",
      ];
      let nodes: Element[] = [];
      for (const s of selectors) {
        const n = Array.from(document.querySelectorAll(s));
        if (n.length > nodes.length) nodes = n;
      }
      const hints: string[] = [];
      for (const el of nodes) {
        const unread = el.querySelector(
          '.badge-num, .badge, [class*="unread"], [class*="Unread"], .reddot, .red-dot, .dot-red, [class*="badge"]',
        );
        if (!unread) continue;
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text.length > 0) hints.push(text.slice(0, 80));
      }
      return hints;
    }, sel)
    .catch(() => []);
}

export function matchItemsByDomHints(items: FriendListItem[], hints: string[]): FriendListItem[] {
  if (hints.length === 0) return [];
  const matched = new Set<FriendListItem>();
  for (const item of items) {
    const n = displayName(item);
    if (!n) continue;
    for (const h of hints) {
      if (h.includes(n) || n.includes(h.slice(0, Math.min(n.length + 5, h.length)))) {
        matched.add(item);
        break;
      }
    }
  }
  return [...matched];
}
