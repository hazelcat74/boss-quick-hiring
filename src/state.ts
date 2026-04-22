import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatStateRecord, FriendListItem, StateFile } from "./types.js";
import { displayName } from "./zhipinApi.js";

const empty: StateFile = { chats: {} };

export function loadState(path: string): StateFile {
  try {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      return structuredClone(empty);
    }
    const data = JSON.parse(readFileSync(path, "utf8")) as StateFile;
    if (!data.chats || typeof data.chats !== "object") return structuredClone(empty);
    return data;
  } catch {
    return structuredClone(empty);
  }
}

export function saveState(path: string, state: StateFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

export function chatKey(item: FriendListItem): string {
  if (item.securityId) return `sec:${item.securityId}`;
  if (item.encryptGeekId) return `geek:${item.encryptGeekId}`;
  if (item.geekId != null) return `id:${item.geekId}`;
  const n = displayName(item);
  if (n) return `name:${n}`;
  return `unknown:${Math.random().toString(36).slice(2)}`;
}

export function getRecord(state: StateFile, key: string): ChatStateRecord {
  if (!state.chats[key]) state.chats[key] = {};
  return state.chats[key];
}
