import { readFileSync } from "node:fs";
import type { Download, Page, Response } from "playwright";
import type { FriendListItem, PatrolConfig } from "./types.js";
import { displayName } from "./zhipinApi.js";
import { sleep } from "./util.js";

export async function pageLooksLikeLogin(page: Page, patterns: string[]): Promise<boolean> {
  const url = page.url();
  if (/login|passport|qrlogin/i.test(url)) return true;
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return patterns.some((p) => body.includes(p));
}

async function readActiveChatTitle(page: Page): Promise<string> {
  // 禁止单独使用 `.geek-name`：左侧列表每一项都有该类，`.first()` 永远是列表顶部那一行，
  // 会造成「界面已切到 Daniel，但读到的仍是王兴发」的假失败。
  const headerScoped = [
    ".chat-top .geek-name",
    ".chat-top .name",
    ".chat-header .geek-name",
    ".conversation-header .geek-name",
    ".im-card-header .geek-name",
    ".detail-area .geek-name",
    ".chat-box .chat-geek-name",
    ".chat-geek-name",
    ".chat-user-name",
    ".name-box .name",
    "[class*='GeekName']",
    ".boss-info .name",
  ];
  for (const sel of headerScoped) {
    const node = page.locator(sel).first();
    if (!(await node.isVisible({ timeout: 300 }).catch(() => false))) continue;
    const t = await node.innerText({ timeout: 500 }).catch(() => "");
    if (t.trim()) return t.trim();
  }
  // 右侧标题取不到时，回退到左侧已选中会话名（新版 Boss 有 selected 状态）
  const selectedName = await page
    .evaluate(() => {
      const n = document.querySelector(".geek-item.selected .geek-name") as HTMLElement | null;
      return (n?.getAttribute("title") || n?.textContent || "").trim();
    })
    .catch(() => "");
  if (selectedName) return selectedName;
  return "";
}

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function titleMatchesExpected(title: string, expectName: string): boolean {
  const a = normalize(expectName);
  const b = normalize(title);
  return b.includes(a) || a.includes(b) || title.includes(expectName) || expectName.includes(title);
}

export async function verifyChatIdentity(page: Page, expectName: string | undefined): Promise<boolean> {
  if (!expectName) return true;
  const title = await readActiveChatTitle(page);
  if (!title) return true;
  return titleMatchesExpected(title, expectName);
}

export async function openChatForFriend(page: Page, config: PatrolConfig, item: FriendListItem): Promise<void> {
  const name = displayName(item);
  if (!name) throw new Error("无法解析候选人展示名，无法打开会话");
  const uid = typeof (item as Record<string, unknown>).uid === "number" || typeof (item as Record<string, unknown>).uid === "string"
    ? String((item as Record<string, unknown>).uid)
    : "";
  const exactClick = async (): Promise<boolean> => {
    const clicked = await page
      .evaluate(
        (payload) => {
          const targetName = String(payload.name || "").replace(/\s+/g, "").trim().toLowerCase();
          if (!targetName) return false;
          const rows = Array.from(document.querySelectorAll(".geek-item")) as HTMLElement[];
          // 1) 先用 uid 对 data-id / id 精确匹配
          if (payload.uid) {
            const idCandidates = [`${payload.uid}-0`, payload.uid, `_${payload.uid}-0`, `_${payload.uid}`];
            for (const id of idCandidates) {
              const byDataId = document.querySelector(`.geek-item[data-id="${id}"]`) as HTMLElement | null;
              if (byDataId) {
                byDataId.click();
                return true;
              }
              const byId = document.getElementById(id) as HTMLElement | null;
              if (byId) {
                byId.click();
                return true;
              }
            }
          }
          // 2) 再按 geek-name title 精确匹配
          for (const row of rows) {
            const nameEl = row.querySelector(".geek-name") as HTMLElement | null;
            if (!nameEl) continue;
            const n = String(nameEl.getAttribute("title") || nameEl.textContent || "")
              .replace(/\s+/g, "")
              .trim()
              .toLowerCase();
            if (n === targetName) {
              row.click();
              return true;
            }
          }
          return false;
        },
        { name, uid },
      )
      .catch(() => false);
    if (!clicked) return false;
    // 切换会话后标题异步更新，单次短 sleep 易读到旧标题
    for (let i = 0; i < 18; i++) {
      await sleep(i === 0 ? 200 : 150);
      const title = await readActiveChatTitle(page);
      if (!title || titleMatchesExpected(title, name)) return true;
    }
    return false;
  };

  if (await exactClick()) return;

  // 保守模式：仅在左侧 geek-item 容器滚动少量次数，避免高频误点击触发风控。
  for (let pass = 0; pass < 4; pass++) {
    await page
      .evaluate(() => {
        const container = document.querySelector(".geek-item-wrap") as HTMLElement | null;
        if (!container) return;
        const step = Math.max(100, Math.floor(container.clientHeight * 0.65));
        container.scrollTop = container.scrollTop + step;
      })
      .catch(() => {});
    await sleep(180);
    if (await exactClick()) return;
  }

  const finalTitle = await readActiveChatTitle(page);
  throw new Error(`未能打开目标会话: expect=${name} current=${finalTitle || "<empty>"}`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickFirstMatchingButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const btn = page.getByRole("button", { name: new RegExp(escapeRe(label)) }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 10000 });
      return true;
    }
  }
  for (const label of labels) {
    const link = page.getByRole("link", { name: new RegExp(escapeRe(label)) }).first();
    if (await link.isVisible().catch(() => false)) {
      await link.click({ timeout: 10000 });
      return true;
    }
  }
  for (const label of labels) {
    const any = page.locator(`text=${label}`).first();
    if (await any.isVisible().catch(() => false)) {
      await any.click({ timeout: 10000 });
      return true;
    }
  }
  return false;
}

export async function tryRequestAttachment(page: Page, config: PatrolConfig): Promise<boolean> {
  return clickFirstMatchingButton(page, config.textPatterns.requestAttachment);
}

export async function tryAcceptAttachmentSend(page: Page, config: PatrolConfig): Promise<boolean> {
  return clickFirstMatchingButton(page, config.textPatterns.acceptSend);
}

export type ResumeCardFlowResult =
  | { outcome: "none" }
  | { outcome: "success"; download: Download; observedPdfUrls: string[] }
  | { outcome: "error"; message: string };

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).equals(PDF_MAGIC);
}

/** 监听 Boss 预览/下载期间返回真实 PDF 字节的 wflow 请求（download.url 常为 blob 或壳页时仍可用）。 */
function attachResumePdfResponseSniffer(page: Page, out: string[]): () => void {
  const onResponse = (resp: Response) => {
    void (async () => {
      try {
        if (!resp.ok()) return;
        const u = resp.url();
        if (!/zhipin\.com/i.test(u)) return;
        if (!/\/wflow\/|preview4boss|zpgeek\/download/i.test(u)) return;
        const ct = (resp.headers()["content-type"] || "").toLowerCase();
        if (!ct.includes("application/pdf") && !ct.includes("application/octet-stream")) return;
        const buf = Buffer.from(await resp.body());
        if (!isPdfBuffer(buf)) return;
        if (!out.includes(u)) out.push(u);
      } catch {
        /* body 不可读或已释放时忽略 */
      }
    })();
  };
  page.on("response", onResponse);
  return () => page.off("response", onResponse);
}

/**
 * Boss 一次点击可能连续触发多个 download（先壳页/占位、后真 PDF）。
 * 轮询：一旦某次已完成且为 PDF 立即返回；仅在「一段时间没有新的 download 事件」后再收束，避免固定长 sleep。
 */
async function pickResumePdfDownload(page: Page, triggerClick: () => Promise<void>): Promise<Download> {
  const received: Download[] = [];
  const onDownload = (dl: Download) => received.push(dl);
  page.on("download", onDownload);
  try {
    await triggerClick();
  } catch (e) {
    page.off("download", onDownload);
    throw e;
  }

  const globalDeadline = Date.now() + 120_000;
  /** 无新增 download 事件后再等这么久即认为连发结束（兼顾真 PDF 晚于壳页几百毫秒的情况） */
  const quietAfterLastEventMs = 420;
  const pollMs = 90;

  const tryPickPdf = async (): Promise<Download | null> => {
    for (let i = received.length - 1; i >= 0; i--) {
      const dl = received[i]!;
      const fail = await dl.failure();
      if (fail) continue;
      const p = await dl.path();
      if (!p) continue;
      const buf = readFileSync(p);
      if (isPdfBuffer(buf)) return dl;
    }
    return null;
  };

  const cancelSiblings = async (keep: Download) => {
    for (const dl of received) {
      if (dl !== keep) await dl.cancel().catch(() => {});
    }
  };

  let lastCount = 0;
  let idleSince = Date.now();

  try {
    while (Date.now() < globalDeadline) {
      await sleep(pollMs);
      if (received.length > lastCount) {
        lastCount = received.length;
        idleSince = Date.now();
      }

      if (received.length === 0) continue;

      const picked = await tryPickPdf();
      if (picked) {
        await cancelSiblings(picked);
        return picked;
      }

      if (Date.now() - idleSince >= quietAfterLastEventMs) {
        const again = await tryPickPdf();
        if (again) {
          await cancelSiblings(again);
          return again;
        }
        return received[received.length - 1]!;
      }
    }

    if (received.length === 0) {
      throw new Error("未收到任何 download 事件");
    }
    const lastChance = await tryPickPdf();
    if (lastChance) {
      await cancelSiblings(lastChance);
      return lastChance;
    }
    return received[received.length - 1]!;
  } finally {
    page.off("download", onDownload);
  }
}

function matchesAnySubstring(text: string, hints: string[]): boolean {
  const t = text.trim();
  if (!t) return false;
  return hints.some((h) => h && t.includes(h));
}

async function scrollConversationNearBottom(page: Page): Promise<void> {
  const list = page.locator(".chat-message-list, .conversation-message, .conversation-main").first();
  if (await list.isVisible({ timeout: 800 }).catch(() => false)) {
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await sleep(350);
  }
}

async function findLastMatchingCardTitle(
  cards: ReturnType<Page["locator"]>,
  titleMatch: (title: string) => boolean,
): Promise<ReturnType<Page["locator"]> | null> {
  const n = await cards.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const wrap = cards.nth(i);
    if (!(await wrap.isVisible({ timeout: 300 }).catch(() => false))) continue;
    const t = await wrap
      .locator("h3.message-card-top-title, .message-card-top-title")
      .first()
      .innerText({ timeout: 800 })
      .catch(() => "");
    if (titleMatch(t)) return wrap;
  }
  return null;
}

async function findLastCardWithPreviewButton(
  cards: ReturnType<Page["locator"]>,
  previewHints: string[],
): Promise<ReturnType<Page["locator"]> | null> {
  const n = await cards.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const wrap = cards.nth(i);
    if (!(await wrap.isVisible({ timeout: 300 }).catch(() => false))) continue;
    const btns = wrap.locator(".message-card-buttons span.card-btn");
    const m = await btns.count().catch(() => 0);
    for (let j = 0; j < m; j++) {
      const txt = (await btns.nth(j).innerText().catch(() => "")).trim();
      if (matchesAnySubstring(txt, previewHints)) return wrap;
    }
  }
  return null;
}

async function clickPreviewOnCard(previewWrap: ReturnType<Page["locator"]>, previewHints: string[]): Promise<boolean> {
  const btns = previewWrap.locator(".message-card-buttons span.card-btn");
  const m = await btns.count().catch(() => 0);
  for (let j = 0; j < m; j++) {
    const b = btns.nth(j);
    const txt = (await b.innerText().catch(() => "")).trim();
    if (matchesAnySubstring(txt, previewHints)) {
      await b.click({ timeout: 10000 });
      return true;
    }
  }
  return false;
}

/**
 * 消息卡片流：同意「对方想发送附件简历」→ 点击预览 → 弹窗内下载 PDF → 关闭弹窗。
 * 无待处理卡片时返回 none（由巡检改发预设话术）。
 */
export async function tryResumeAttachmentCardFlow(page: Page, config: PatrolConfig): Promise<ResumeCardFlowResult> {
  const consentHints = config.textPatterns.resumeConsentCardIncludes;
  const previewHints = config.textPatterns.resumePreviewButtonIncludes;
  const cardRoot = page.locator(".chat-conversation .message-card-wrap");

  await scrollConversationNearBottom(page);

  const consentWrap = await findLastMatchingCardTitle(cardRoot, (t) => matchesAnySubstring(t, consentHints));
  let clickedConsent = false;
  if (consentWrap) {
    const agree = consentWrap.locator(".message-card-buttons span.card-btn").filter({ hasText: /^同意$/ });
    if (await agree.isVisible({ timeout: 2000 }).catch(() => false)) {
      await agree.click({ timeout: 8000 });
      clickedConsent = true;
      await sleep(900);
    }
  }

  let previewWrap = await findLastCardWithPreviewButton(cardRoot, previewHints);
  if (!previewWrap && (consentWrap || clickedConsent)) {
    for (let w = 0; w < 20; w++) {
      await sleep(400);
      previewWrap = await findLastCardWithPreviewButton(cardRoot, previewHints);
      if (previewWrap) break;
    }
  }

  if (!previewWrap) {
    if (clickedConsent) {
      return { outcome: "error", message: "已点同意，但未出现「点击预览附件简历」按钮" };
    }
    return { outcome: "none" };
  }

  try {
    const clicked = await clickPreviewOnCard(previewWrap, previewHints);
    if (!clicked) return { outcome: "none" };
  } catch (e) {
    return { outcome: "error", message: `点击预览失败: ${(e as Error).message}` };
  }

  const resumeDialog = page
    .locator('[id^="boss-dynamic-dialog"]')
    .filter({ has: page.locator(".resume-content, .resume-footer-wrap, .resume-common-dialog") })
    .last();

  try {
    await resumeDialog.waitFor({ state: "visible", timeout: 25000 });
  } catch {
    return { outcome: "error", message: "预览弹窗未在超时内出现" };
  }

  const observedPdfUrls: string[] = [];
  const detachSniffer = attachResumePdfResponseSniffer(page, observedPdfUrls);

  const useIcon = resumeDialog.locator(
    'use[href*="icon-attacthment-download"], use[href*="icon-attachment-download"], use[*|href*="icon-attacthment-download"], use[*|href*="icon-attachment-download"]',
  );

  let download: Download;
  try {
    download = await pickResumePdfDownload(page, async () => {
      if (await useIcon.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await useIcon.first().click({ timeout: 8000, force: true });
      } else {
        const footerSvg = resumeDialog.locator(".resume-footer-wrap svg.boss-svg").last();
        if (await footerSvg.isVisible({ timeout: 2500 }).catch(() => false)) {
          await footerSvg.click({ timeout: 8000 });
        } else {
          await resumeDialog.locator(".resume-footer-wrap span").filter({ has: page.locator("svg") }).last().click({ timeout: 8000 });
        }
      }
    });
  } catch (e) {
    const msg = (e as Error).message;
    const label =
      msg.includes("未收到任何 download") || msg.includes("download 事件")
        ? `未收到下载事件: ${msg}`
        : `点击下载图标或等待下载失败: ${msg}`;
    await resumeDialog.locator(".close-btn").first().click({ timeout: 3000 }).catch(() => {});
    return { outcome: "error", message: label };
  } finally {
    detachSniffer();
  }

  await resumeDialog.locator(".close-btn").first().click({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(400);

  return { outcome: "success", download, observedPdfUrls };
}

/**
 * 在当前会话发送自定义消息。
 * 必须在「沟通主区域」内定位输入框，避免误选页面其它 textarea（如左侧搜索框）。
 */
export async function trySendCustomMessage(page: Page, message: string): Promise<boolean> {
  const chatRoots = [
    ".chat-conversation",
    ".chat-box",
    "[class*='chat-input']",
    "[class*='im-input']",
    ".conversation-box",
    "#container.chat-container-private",
  ];

  const tryFillTextarea = async (root: ReturnType<Page["locator"]>): Promise<boolean> => {
    const list = root.locator("textarea");
    const n = await list.count().catch(() => 0);
    // 从后往前试：列表里靠前的往往是隐藏/占位，靠后的更接近当前会话输入框
    for (let i = n - 1; i >= 0; i--) {
      const el = list.nth(i);
      if (!(await el.isVisible({ timeout: 800 }).catch(() => false))) continue;
      try {
        await el.click({ timeout: 3000 });
        await el.fill("", { timeout: 1000 }).catch(() => {});
        await el.fill(message, { timeout: 8000 });
        return true;
      } catch {
        /* next */
      }
    }
    return false;
  };

  const tryFillContentEditable = async (root: ReturnType<Page["locator"]>): Promise<boolean> => {
    const list = root.locator('[contenteditable="true"]');
    const n = await list.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      const el = list.nth(i);
      if (!(await el.isVisible({ timeout: 800 }).catch(() => false))) continue;
      try {
        await el.click({ timeout: 3000 });
        await page.keyboard.press("Control+A").catch(() => {});
        await page.keyboard.press("Backspace").catch(() => {});
        await page.keyboard.type(message, { delay: 6 });
        return true;
      } catch {
        /* next */
      }
    }
    return false;
  };

  let typed = false;
  for (const rootSel of chatRoots) {
    const root = page.locator(rootSel).first();
    if (!(await root.isVisible({ timeout: 500 }).catch(() => false))) continue;
    if (await tryFillTextarea(root)) {
      typed = true;
      break;
    }
    if (await tryFillContentEditable(root)) {
      typed = true;
      break;
    }
  }

  // 最后兜底：仅在「容器」内找 textarea，绝不使用全局第一个 textarea
  if (!typed) {
    const fallback = page.locator("#container.chat-container-private textarea, .wrap-v2 textarea");
    const n = await fallback.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      const el = fallback.nth(i);
      if (!(await el.isVisible({ timeout: 800 }).catch(() => false))) continue;
      try {
        await el.click({ timeout: 3000 });
        await el.fill(message, { timeout: 8000 });
        typed = true;
        break;
      } catch {
        /* next */
      }
    }
  }

  if (!typed) return false;

  // 部分版本需触发 input 后「发送」才变 active
  const sendActive = page.locator(".submit.active").first();
  if (!(await sendActive.isVisible({ timeout: 1200 }).catch(() => false))) {
    await page.keyboard.press("End").catch(() => {});
    await page.keyboard.type(" ", { delay: 20 }).catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await sleep(200);
  }

  const sendBtnCandidates = [".submit.active", ".submit", "button:has-text('发送')", "div.submit:has-text('发送')"];
  for (const sel of sendBtnCandidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click({ timeout: 5000 });
      await sleep(500);
      return true;
    }
  }
  return false;
}
