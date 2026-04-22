import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PatrolConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const defaultConfig: PatrolConfig = {
  chatUrl: "https://www.zhipin.com/web/chat/index",
  pdfDir: resolve(projectRoot, "bosspdf"),
  cdpUrl: process.env.BOSS_CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  statePath: resolve(projectRoot, "data", "state.json"),
  logDir: resolve(projectRoot, "data", "logs"),
  autoMessageText: "同学你好，此岗位属于字节跳动-data-AI芯片业务组的需求。感兴趣可以发我一份简历，我推给面试官看看~",
  friendListApiCandidates: [
    "https://www.zhipin.com/wapi/zprelation/friend/getBossFriendList.json?page=1",
    "https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json?page=1",
  ],
  selectors: {
    sidebarUserItem: ".chat-user-list .item",
    chatPanel: ".chat-conversation",
  },
  textPatterns: {
    requestAttachment: ["索要附件简历", "附件简历"],
    acceptSend: ["接受", "同意发送", "确定"],
    loginRequired: ["登录", "短信登录", "扫码登录"],
    resumeConsentCardIncludes: ["对方想发送附件简历"],
    resumePreviewButtonIncludes: ["点击预览附件简历"],
  },
  recommendGreet: {
    recommendUrl: "https://www.zhipin.com/web/chat/recommend",
    maxGreets: 60,
    applyFilters: true,
    filterSteps: [
      { type: "option", text: "985" },
      { type: "option", text: "211" },
      { type: "option", text: "国内外名校" },
      { type: "firstDegreeCheckbox" },
      { type: "option", text: "3-5年" },
      { type: "option", text: "5-10年" },
      { type: "option", text: "离职-随时到岗" },
      { type: "option", text: "在职-考虑机会" },
      { type: "option", text: "在职-月内到岗" },
    ],
    betweenGreetsMinMs: 450,
    betweenGreetsMaxMs: 1100,
  },
};

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function loadConfig(): PatrolConfig {
  const pathFromEnv = process.env.BOSS_ASSISTANT_CONFIG;
  const defaultPath = resolve(projectRoot, "config.json");
  const path = pathFromEnv ? resolve(pathFromEnv) : defaultPath;
  if (!existsSync(path)) {
    return { ...defaultConfig };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return deepMerge(defaultConfig as unknown as Record<string, unknown>, raw) as unknown as PatrolConfig;
}
