/**
 * 推荐牛人页：筛选（可选）+ 批量「打招呼」。一次性执行，非定时任务。
 * Chrome：`--remote-debugging-port=9222`（及可选 `--user-data-dir`）与巡检相同。
 */
import { loadConfig } from "./config.js";
import { pageLooksLikeLogin } from "./actions.js";
import { connectOverCDP, getOrOpenBossWebPage } from "./browser.js";
import { createRunLogger } from "./logger.js";
import { sleep } from "./util.js";
import type { RecommendGreetFilterStep } from "./types.js";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(): { maxOverride: number | null; noFilters: boolean } {
  let maxOverride: number | null = null;
  let noFilters = false;
  for (const a of process.argv.slice(2)) {
    if (a === "--no-filters") noFilters = true;
    else if (a.startsWith("--max=")) {
      const n = Number.parseInt(a.slice(6), 10);
      if (Number.isFinite(n) && n > 0) maxOverride = n;
    }
  }
  return { maxOverride, noFilters };
}

function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * Math.max(1, max - min + 1));
}

type Pageish = import("playwright").Page | import("playwright").Frame;

function rootsForBoss(page: import("playwright").Page): Pageish[] {
  return [page, ...page.frames().filter((f) => f !== page.mainFrame())];
}

async function filterPanelLooksOpen(root: Pageish): Promise<boolean> {
  const candidates = [
    ".filter-panel",
    ".vip-filters.open",
    ".ui-dropdown-menu",
    ".ui-dropdown-content",
    ".filters-wrap.vip-filters.open",
  ];
  for (const sel of candidates) {
    const n = await root.locator(sel).count().catch(() => 0);
    if (n <= 0) continue;
    const node = root.locator(sel).first();
    if (await node.isVisible({ timeout: 300 }).catch(() => false)) return true;
  }
  return false;
}

async function findOpenedFilterRoot(page: import("playwright").Page): Promise<Pageish | null> {
  for (const root of rootsForBoss(page)) {
    if (await filterPanelLooksOpen(root)) return root;
  }
  return null;
}

async function openFilterPanel(page: import("playwright").Page, log: ReturnType<typeof createRunLogger>): Promise<Pageish | null> {
  const openedNow = await findOpenedFilterRoot(page);
  if (openedNow) return openedNow;

  log.info("等待筛选条挂载（最多约 12s）…");
  const attached = await page
    .waitForSelector(".recommend-filter.op-filter, .se-operate, .filter-label-wrap", { state: "attached", timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  const barCount = await page.locator(".recommend-filter.op-filter, .se-operate").count().catch(() => 0);
  log.info(`筛选条挂载: ${attached}；主文档候选容器数量=${barCount}`);

  const waitPanelAfterClick = async (): Promise<Pageish | null> => {
    for (let i = 0; i < 6; i++) {
      await sleep(250);
      const r = await findOpenedFilterRoot(page);
      if (r) return r;
    }
    return null;
  };

  const clickPlan = [
    ".recommend-filter.op-filter .filter-label-wrap",
    ".se-operate .filter-label-wrap",
    ".recommend-filter.op-filter .filter-label",
    ".se-operate .filter-label",
    ".recommend-filter.op-filter .filter-arrow-down svg",
    ".se-operate .filter-arrow-down svg",
    ".recommend-filter.op-filter .filter-arrow-down",
    ".se-operate .filter-arrow-down",
    ".recommend-filter.op-filter .filter-wrap",
    ".se-operate .filter-wrap",
    ".recommend-filter.op-filter",
    ".se-operate",
  ];

  for (const root of rootsForBoss(page)) {
    for (const sel of clickPlan) {
      const target = root.locator(sel).first();
      if (!(await target.isVisible({ timeout: 700 }).catch(() => false))) continue;
      log.info(`尝试点击筛选入口: ${sel}`);
      await target.click({ timeout: 6000, force: true }).catch(() => {});
      const openedRoot = await waitPanelAfterClick();
      if (openedRoot) {
        log.info(`筛选面板已打开（命中 ${sel}）。`);
        return openedRoot;
      }
      // 若点到的是 toggle，不要紧接着第二次高速点击
      await sleep(250);
    }
  }

  return null;
}

async function clickFilterOption(root: Pageish, text: string): Promise<boolean> {
  const panel = root.locator(".filter-panel");
  const opt = panel.locator("div.option").filter({ hasText: new RegExp(`^${escapeRe(text)}$`) }).first();
  if (!(await opt.isVisible({ timeout: 2500 }).catch(() => false))) {
    return false;
  }
  await opt.scrollIntoViewIfNeeded().catch(() => {});
  await opt.click({ timeout: 6000 });
  await sleep(180);
  return true;
}

async function clickFirstDegreeCheckbox(root: Pageish): Promise<boolean> {
  const box = root.locator(".filter-panel .first-degree-wrap span.check-box").first();
  if (!(await box.isVisible({ timeout: 2500 }).catch(() => false))) return false;
  await box.click({ timeout: 6000 });
  await sleep(200);
  return true;
}

async function confirmFilterPanel(root: Pageish): Promise<void> {
  const btn = root.locator(".filter-panel div.btns div.btn").filter({ hasText: /^确定$/ }).first();
  await btn.click({ timeout: 10000 });
  await sleep(800);
}

async function applyRecommendFilters(
  page: import("playwright").Page,
  steps: RecommendGreetFilterStep[],
  log: ReturnType<typeof createRunLogger>,
): Promise<void> {
  const openedRoot = await openFilterPanel(page, log);
  if (!openedRoot) {
    log.warn("未找到「筛选」入口或面板未展开，跳过筛选步骤。");
    return;
  }
  for (const step of steps) {
    if (step.type === "option") {
      const ok = await clickFilterOption(openedRoot, step.text);
      if (!ok) log.warn(`筛选项未点到（可能无 VIP 或无该选项）: ${step.text}`);
    } else if (step.type === "firstDegreeCheckbox") {
      const ok = await clickFirstDegreeCheckbox(openedRoot);
      if (!ok) log.warn("未找到「第一学历」勾选框，跳过。");
    }
  }
  await confirmFilterPanel(openedRoot);
  log.info("筛选面板已确定。");
}

async function clickGreetButtons(
  page: import("playwright").Page,
  maxGreets: number,
  minMs: number,
  maxMs: number,
  log: ReturnType<typeof createRunLogger>,
): Promise<number> {
  await page.locator("#recommend-list, .recommend-list, .se-recommend").first().waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
  let clicks = 0;
  let stagnant = 0;
  let consecutiveFailures = 0;
  const stagnantLimit = 25;
  const failureLimit = 4;
  const greetSelector = [
    "#recommend-list > div > ul > li .operate-side .button-chat-wrap.button-chat button.btn.btn-greet",
    "#recommend-list button.btn.btn-greet",
    "button.btn.btn-greet",
  ].join(", ");
  const listSelector = "#recommend-list, .recommend-list, .se-recommend, body";

  while (clicks < maxGreets && stagnant < stagnantLimit && consecutiveFailures < failureLimit) {
    let clicked = false;
    for (const root of rootsForBoss(page)) {
      const greet = root
        .locator(greetSelector)
        .filter({ hasText: /打招呼/ })
        .first();
      const visible = await greet.isVisible({ timeout: 700 }).catch(() => false);
      const enabled = visible ? await greet.isEnabled().catch(() => false) : false;
      if (!visible || !enabled) continue;
      await greet.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await greet.click({ timeout: 10000 });
        clicks++;
        stagnant = 0;
        consecutiveFailures = 0;
        clicked = true;
        log.info(`打招呼进度 ${clicks}/${maxGreets}`);
        await sleep(randBetween(minMs, maxMs));
        break;
      } catch (e) {
        log.warn(`点击打招呼失败: ${(e as Error).message}`);
        consecutiveFailures++;
        if (consecutiveFailures >= failureLimit) {
          log.warn(`连续打招呼失败 ${failureLimit} 次，自动停止以避免平台异常检测。`);
          return clicks;
        }
      }
    }
    if (clicked) continue;

    for (const root of rootsForBoss(page)) {
      await root
        .locator(listSelector)
        .first()
        .evaluate((el) => {
          el.scrollTop = Math.min(el.scrollTop + 460, el.scrollHeight);
        })
        .catch(() => {});
    }
    await sleep(550);
    stagnant++;
  }
  if (stagnant >= stagnantLimit) {
    log.warn("列表滚动多次仍无可点「打招呼」，可能已无候选人或按钮状态已变。");
  }
  return clicks;
}

async function main(): Promise<number> {
  const config = loadConfig();
  const { maxOverride, noFilters } = parseArgs();
  const rg = config.recommendGreet;
  const maxGreets = maxOverride ?? rg.maxGreets;
  const applyFilters = rg.applyFilters && !noFilters;

  const log = createRunLogger(config.logDir, "recommend-greet");
  log.info(`推荐牛人打招呼：url=${rg.recommendUrl} maxGreets=${maxGreets} applyFilters=${applyFilters}`);
  log.info(`日志文件: ${log.logPath}`);

  let browser;
  try {
    log.info("正在连接 CDP…");
    const conn = await connectOverCDP(config.cdpUrl);
    browser = conn.browser;
    log.info("CDP 已连接，正在打开/切换到推荐牛人页（已在该页则跳过完整 goto）…");
    const page = await getOrOpenBossWebPage(conn.context, rg.recommendUrl, {
      skipGotoIfUrlIncludes: "/web/chat/recommend",
      gotoTimeoutMs: 35000,
    });
    log.info(`当前 URL: ${page.url()}`);
    await sleep(800);
    log.info("等待列表或筛选条（最多约 12s）…");
    await page.waitForSelector("#recommend-list, .recommend-filter.op-filter", { timeout: 12000 }).catch(() => {});
    log.info("继续执行筛选 / 打招呼逻辑…");

    if (await pageLooksLikeLogin(page, config.textPatterns.loginRequired)) {
      log.warn("页面疑似未登录，退出。");
      return 2;
    }

    if (applyFilters) {
      await applyRecommendFilters(page, rg.filterSteps, log);
    } else {
      log.info("已跳过筛选（配置或 --no-filters）。");
    }

    const n = await clickGreetButtons(page, maxGreets, rg.betweenGreetsMinMs, rg.betweenGreetsMaxMs, log);
    log.info(`本轮共点击打招呼 ${n} 次（上限 ${maxGreets}）。结束。`);
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
