/**
 * Boss 直聘沟通页巡检。Chrome 需：--remote-debugging-port=9222 --user-data-dir=...
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Download, Page } from "playwright";
import { loadConfig } from "./config.js";
import type { FriendListItem } from "./types.js";
import { createRunLogger } from "./logger.js";
import { chatKey, getRecord, loadState, saveState } from "./state.js";
import {
  openChatForFriend,
  pageLooksLikeLogin,
  tryResumeAttachmentCardFlow,
  trySendCustomMessage,
  verifyChatIdentity,
} from "./actions.js";
import { connectOverCDP, getOrOpenChatPage } from "./browser.js";
import { sleep } from "./util.js";
import {
  displayName,
  fetchFriendListInPageWithProbe,
  isLikelyUnread,
  listUnreadDisplayHintsFromDom,
  matchItemsByDomHints,
} from "./zhipinApi.js";

function pickDebugSnapshot(item: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "name",
    "securityId",
    "chatStatus",
    "newGeek",
    "lastMsg",
    "lastTime",
    "lastTS",
    "unread",
    "unreadCount",
    "unreadMsgCount",
    "badgeNum",
    "msgUnreadCount",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in item) out[k] = item[k];
  }
  const lm = item.lastMessageInfo;
  if (lm && typeof lm === "object") {
    const o = lm as Record<string, unknown>;
    out.lastMessageInfo = {
      status: o.status,
      fromId: o.fromId,
      unread: o.unread,
      unreadCount: o.unreadCount,
      unreadMsgCount: o.unreadMsgCount,
      unReadCount: o.unReadCount,
      type: o.type,
    };
  }
  return out;
}

function debugPotentialUnreadStats(items: Array<Record<string, unknown>>): string {
  const byNewGeek = items.filter((i) => i.newGeek === true || i.newGeek === 1).length;
  const byChatStatus = new Map<string, number>();
  for (const i of items) {
    if (!("chatStatus" in i)) continue;
    const k = String(i.chatStatus);
    byChatStatus.set(k, (byChatStatus.get(k) ?? 0) + 1);
  }
  const statusText = [...byChatStatus.entries()]
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  return `newGeek=${byNewGeek}; chatStatusDist={${statusText}}`;
}

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).equals(PDF_MAGIC);
}

function pickUrlFromUnknown(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const seen = new Set<unknown>();
  const queue: unknown[] = [obj];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);

    const rec = cur as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === "string" && /^https?:\/\//i.test(v) && /pdf|download|attachment|resume|file/i.test(k)) {
        return v;
      }
      if (v && typeof v === "object") queue.push(v);
    }
  }
  return null;
}

/**
 * Boss 附件下载常以「PDF 查看器壳页」触发：download.url() 形如
 * /bzl-office/pdf-viewer-b?url=%2Fwflow%2Fzpgeek%2Fdownload%2Fpreview4boss%2F...
 * 直接请求壳页得到 HTML，保存后像「乱码」；真实 PDF 在 query 参数 `url` 指向的路径上。
 */
function candidateBossResumePdfUrls(downloadUrl: string, pageUrlForBase: string): string[] {
  const ordered: string[] = [];
  const add = (u: string) => {
    const s = u.trim();
    if (s && !ordered.includes(s)) ordered.push(s);
  };

  let defaultOrigin = "https://www.zhipin.com";
  try {
    defaultOrigin = new URL(pageUrlForBase).origin;
  } catch {
    /* keep default */
  }

  const baseForResolve = pageUrlForBase || `${defaultOrigin}/`;

  try {
    const u = new URL(downloadUrl, baseForResolve);
    const pathLower = u.pathname.toLowerCase();
    const isViewerShell =
      pathLower.includes("pdf-viewer") ||
      pathLower.includes("bzl-office/pdf") ||
      (pathLower.includes("bzl-office") && u.searchParams.has("url"));
    if (isViewerShell) {
      const rawInner = u.searchParams.get("url");
      if (rawInner) {
        let decoded = rawInner;
        try {
          decoded = decodeURIComponent(rawInner.replace(/\+/g, "%20"));
        } catch {
          /* keep rawInner */
        }
        if (/^https?:\/\//i.test(decoded)) {
          add(decoded);
        } else {
          const path = decoded.startsWith("/") ? decoded : `/${decoded}`;
          add(new URL(path, u.origin).href);
        }
      }
    }
  } catch {
    /* ignore malformed downloadUrl */
  }

  try {
    add(new URL(downloadUrl, baseForResolve).href);
  } catch {
    add(downloadUrl);
  }
  return ordered;
}

async function fetchPdfBufferFromUrl(page: Page, url: string, referer: string): Promise<Buffer | null> {
  const r = await page.request.get(url, {
    timeout: 90_000,
    headers: {
      accept: "application/pdf,application/octet-stream,*/*",
      referer: referer || url,
    },
  });
  if (!r.ok()) return null;
  const body = Buffer.from(await r.body());
  if (isPdfBuffer(body)) return body;

  const ctype = (r.headers()["content-type"] || "").toLowerCase();
  const maybeJson = ctype.includes("json") || (body.length > 1 && body[0] === 123);
  if (!maybeJson) return null;

  try {
    const j = JSON.parse(body.toString("utf8")) as unknown;
    const nestedUrl = pickUrlFromUnknown(j);
    if (!nestedUrl) return null;
    const rr = await page.request.get(nestedUrl, {
      timeout: 90_000,
      headers: {
        accept: "application/pdf,application/octet-stream,*/*",
        referer: referer || url,
      },
    });
    if (!rr.ok()) return null;
    const body2 = Buffer.from(await rr.body());
    return isPdfBuffer(body2) ? body2 : null;
  } catch {
    return null;
  }
}

async function tryContextRequestPdf(
  page: Page,
  downloadUrl: string,
  prependCandidates?: string[],
): Promise<Buffer | null> {
  const referer = page.url();
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (u: string | undefined) => {
    const s = (u || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    ordered.push(s);
  };
  for (const u of prependCandidates ?? []) push(u);
  if (downloadUrl.trim()) {
    for (const u of candidateBossResumePdfUrls(downloadUrl, referer)) push(u);
  }

  for (const candidate of ordered) {
    const buf = await fetchPdfBufferFromUrl(page, candidate, referer).catch(() => null);
    if (buf && isPdfBuffer(buf)) return buf;
  }
  return null;
}

async function saveDownloadToDir(
  dl: Download,
  page: Page,
  pdfDir: string,
  geekName: string,
  observedPdfUrls?: string[],
): Promise<string> {
  const fail = await dl.failure();
  if (fail) throw new Error(`浏览器下载失败: ${fail}`);

  mkdirSync(pdfDir, { recursive: true });
  let suggested = (dl.suggestedFilename() || "").trim();
  if (!suggested) suggested = `resume-${Date.now()}.pdf`;
  else if (!/\.pdf$/i.test(suggested)) {
    suggested = /[.]/.test(suggested) ? suggested.replace(/\.[^.]+$/, "") + ".pdf" : `${suggested}.pdf`;
  }
  const safe = suggested.replace(/[^\w.\-()\u4e00-\u9fa5]/g, "_");
  const dest = join(pdfDir, `${geekName || "unknown"}_${safe}`);
  await dl.saveAs(dest);

  let buf: Buffer = readFileSync(dest);
  if (buf.length < 8) {
    unlinkSync(dest);
    throw new Error("下载文件过小，可能未完成或被拦截");
  }
  if (!isPdfBuffer(buf)) {
    const prepend = observedPdfUrls?.length ? [...observedPdfUrls].reverse() : [];
    const rescued = await tryContextRequestPdf(page, dl.url(), prepend).catch(() => null);
    if (rescued && isPdfBuffer(rescued)) {
      writeFileSync(dest, rescued);
      buf = rescued;
    }
  }

  if (!isPdfBuffer(buf)) {
    const probe = /\.pdf$/i.test(dest) ? dest.replace(/\.pdf$/i, "") + ".not-pdf.txt" : `${dest}.not-pdf.txt`;
    const snippet = buf.toString("utf8", 0, Math.min(1200, buf.length));
    writeFileSync(probe, snippet, "utf8");
    unlinkSync(dest);
    throw new Error(
      `保存内容不是 PDF（常见为 Boss 返回 JSON：登录失效 code=7 等）。` +
        `已删除伪 PDF，前 1200 字符写入: ${probe}。请在已登录的 Chrome 中重新下载或重新登录后再跑巡检。`,
    );
  }
  return dest;
}

async function main(): Promise<number> {
  const config = loadConfig();
  const log = createRunLogger(config.logDir);
  const state = loadState(config.statePath);

  log.info(`配置已加载，CDP=${config.cdpUrl}，PDF 目录=${config.pdfDir}`);
  log.info(`日志文件: ${log.logPath}`);

  let browser;
  try {
    const conn = await connectOverCDP(config.cdpUrl);
    browser = conn.browser;
    const page = await getOrOpenChatPage(conn.context, config.chatUrl);
    await sleep(2000);

    if (await pageLooksLikeLogin(page, config.textPatterns.loginRequired)) {
      log.warn("页面疑似未登录或处于登录页，本轮跳过。");
      return 2;
    }

    const { result: listResult, probe } = await fetchFriendListInPageWithProbe(page, config.friendListApiCandidates);
    if (!listResult || listResult.items.length === 0) {
      log.warn("未能通过 wapi 拉取会话列表（可能接口变更或未登录）。将尝试仅用 DOM 红点推断未读。");
    }

    if (process.env.BOSS_DEBUG_FRIEND === "1") {
      for (const row of probe) {
        const parts = [
          `http=${row.httpStatus}`,
          `code=${row.code ?? "?"}`,
          `len=${row.arrayLen}`,
          `zpKeys=[${row.zpDataKeys.join(",")}]`,
        ];
        if (row.message) parts.push(`msg=${row.message}`);
        if (row.error) parts.push(`err=${row.error}`);
        log.info(`DEBUG wapi: ${row.url} :: ${parts.join(" | ")}`);
      }
    }

    const items = listResult?.items ?? [];
    if (process.env.BOSS_DEBUG_FRIEND === "1" && items[0]) {
      log.info(`DEBUG 首条会话键示例: ${JSON.stringify(Object.keys(items[0])).slice(0, 800)}`);
      log.info(`DEBUG 首条会话快照: ${JSON.stringify(pickDebugSnapshot(items[0] as Record<string, unknown>)).slice(0, 1000)}`);
      if (items[1]) {
        log.info(`DEBUG 第二条会话快照: ${JSON.stringify(pickDebugSnapshot(items[1] as Record<string, unknown>)).slice(0, 1000)}`);
      }
      log.info(`DEBUG 会话统计: ${debugPotentialUnreadStats(items as Array<Record<string, unknown>>)}`);
    }

    // 接口未读与左侧红点合并：仅当接口全空时才用 DOM 会漏掉「接口只标了 1 条但红点还有很多」的情况。
    const apiUnread = items.filter(isLikelyUnread);
    let domMatched: FriendListItem[] = [];
    if (items.length > 0) {
      const hints = await listUnreadDisplayHintsFromDom(page, config);
      if (process.env.BOSS_DEBUG_FRIEND === "1") {
        log.info(`DEBUG DOM 红点候选数: ${hints.length}`);
        if (hints[0]) log.info(`DEBUG DOM 红点示例: ${hints[0]}`);
      }
      if (hints.length > 0) {
        domMatched = matchItemsByDomHints(items, hints);
      }
    }
    const unreadKeySet = new Set<string>();
    for (const it of apiUnread) unreadKeySet.add(chatKey(it));
    for (const it of domMatched) unreadKeySet.add(chatKey(it));
    const unreadItems = items.filter((it) => unreadKeySet.has(chatKey(it)));

    if (apiUnread.length === 0 && domMatched.length > 0) {
      log.info(`接口未标未读，已根据左侧红点并入 ${domMatched.length} 个会话。`);
    } else if (domMatched.length > 0 && unreadItems.length > apiUnread.length) {
      log.info(`未读合并：接口标未读 ${apiUnread.length} 条，DOM 红点匹配 ${domMatched.length} 条，去重后共 ${unreadItems.length} 条。`);
    }

    if (unreadItems.length === 0) {
      log.info("未发现未读会话，结束。");
      saveState(config.statePath, state);
      return 0;
    }

    log.info(`未读会话数（本轮全部处理）: ${unreadItems.length}`);

    let actions = 0;
    let consecutiveOpenFailures = 0;
    for (let idx = 0; idx < unreadItems.length; idx++) {
      const item = unreadItems[idx]!;

      const key = chatKey(item);
      const rec = getRecord(state, key);
      const name = displayName(item) ?? "unknown";
      log.info(`开始处理会话 ${idx + 1}/${unreadItems.length}: ${name}`);

      try {
        await openChatForFriend(page, config, item);
        consecutiveOpenFailures = 0;
        const ok = await verifyChatIdentity(page, displayName(item));
        if (!ok) {
          log.warn(`身份校验未通过，跳过: key=${key} expect≈${name}`);
          continue;
        }

        // 有「对方请求发附件简历」消息卡片时：只走同意→预览→下载→关窗，不发预设话术
        if (!rec.attachmentReceivedAt) {
          const cardRes = await tryResumeAttachmentCardFlow(page, config);
          if (cardRes.outcome === "success") {
            try {
              const path = await saveDownloadToDir(cardRes.download, page, config.pdfDir, name, cardRes.observedPdfUrls);
              rec.attachmentReceivedAt = new Date().toISOString();
              rec.lastPdfPath = path;
              rec.messageSentAt = new Date().toISOString();
              rec.lastGeekName = name;
              actions++;
              log.info(`已通过消息卡片下载简历: ${path}`);
              saveState(config.statePath, state);
            } catch (e) {
              log.error(`保存下载失败: ${(e as Error).message}`);
            }
            continue;
          }
          if (cardRes.outcome === "error") {
            log.warn(`消息卡片简历流失败 ${name}: ${cardRes.message}`);
          }
        }

        if (config.autoMessageText && !rec.messageSentAt) {
          const sent = await trySendCustomMessage(page, config.autoMessageText);
          if (sent) {
            rec.messageSentAt = new Date().toISOString();
            rec.lastGeekName = name;
            actions++;
            log.info(`已发送沟通消息: ${name} (${key})`);
            saveState(config.statePath, state);
            continue;
          } else {
            log.warn(`未找到可用输入框或发送按钮，消息未发出: ${name}`);
          }
        }
      } catch (e) {
        const message = (e as Error).message;
        log.error(`处理会话失败 ${name}: ${message}`);
        if (message.includes("未能打开目标会话")) {
          consecutiveOpenFailures++;
          if (consecutiveOpenFailures >= 2) {
            log.warn("连续 2 个会话切换失败，进入保守暂停，避免触发 Boss 异常检测。");
            break;
          }
        }
      }
      await sleep(700 + Math.floor(Math.random() * 600));
    }

    saveState(config.statePath, state);
    log.info(`本轮巡检结束。执行动作数: ${actions}`);
    return 0;
  } catch (e) {
    log.error((e as Error).message);
    return 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
