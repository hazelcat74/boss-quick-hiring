import type { Browser, BrowserContext, Page } from "playwright";

export async function connectOverCDP(cdpUrl: string): Promise<{ browser: Browser; context: BrowserContext }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30000 });
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("CDP 已连接但未发现浏览器上下文，请确认 Chrome 已用远程调试方式启动且未使用隔离配置。");
  }
  const context = contexts[0]!;
  return { browser, context };
}

export async function getOrOpenChatPage(context: BrowserContext, chatUrl: string): Promise<Page> {
  const pages = context.pages().filter((p) => !p.isClosed());
  const chatPage = pages.find((p) => /zhipin\.com\/web\/chat/i.test(p.url()));
  const page = chatPage ?? pages[0] ?? (await context.newPage());
  await page.bringToFront().catch(() => {});
  await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  return page;
}

/** 推荐页等场景：避免在已是目标 URL 时重复 goto 导致长时间挂起；导航用 commit 尽早返回 */
export async function getOrOpenBossWebPage(
  context: BrowserContext,
  targetUrl: string,
  options?: { skipGotoIfUrlIncludes?: string; gotoTimeoutMs?: number },
): Promise<Page> {
  const pages = context.pages().filter((p) => !p.isClosed());
  const page = pages.find((p) => /zhipin\.com\/web\/chat/i.test(p.url())) ?? pages[0] ?? (await context.newPage());
  await page.bringToFront().catch(() => {});
  const cur = page.url();
  const skip = options?.skipGotoIfUrlIncludes;
  if (skip && cur.includes(skip)) {
    return page;
  }
  const timeout = options?.gotoTimeoutMs ?? 45000;
  await page.goto(targetUrl, { waitUntil: "commit", timeout });
  await page.waitForLoadState("domcontentloaded", { timeout: 25000 }).catch(() => {});
  return page;
}
