/** 好友列表接口返回的单条记录（字段随 Boss 端调整，保持宽松） */
export type FriendListItem = Record<string, unknown> & {
  securityId?: string;
  encryptGeekId?: string;
  geekId?: number;
  geekName?: string;
  name?: string;
  unreadMsgCount?: number;
  unreadCount?: number;
  unreadMidMsgCount?: number;
  hiCardUnRead?: number;
  badgeNum?: number;
  msgUnreadCount?: number;
  unread?: number | boolean;
  friendSource?: number;
  lastMessageInfo?: Record<string, unknown>;
  formUser?: { userName?: string };
};

/** 推荐牛人筛选面板内的一步操作 */
export type RecommendGreetFilterStep =
  | { type: "option"; text: string }
  | { type: "firstDegreeCheckbox" };

/** 「推荐牛人」页批量打招呼（一次性任务，非定时巡检） */
export type RecommendGreetConfig = {
  recommendUrl: string;
  maxGreets: number;
  /** 是否在打招呼前打开筛选并点选 filterSteps */
  applyFilters: boolean;
  /** 依次点击的筛选项；顺序与 Boss 面板一致 */
  filterSteps: RecommendGreetFilterStep[];
  betweenGreetsMinMs: number;
  betweenGreetsMaxMs: number;
};

export type PatrolConfig = {
  chatUrl: string;
  pdfDir: string;
  cdpUrl: string;
  statePath: string;
  logDir: string;
  autoMessageText?: string;
  friendListApiCandidates: string[];
  selectors: {
    sidebarUserItem: string;
    chatPanel: string;
  };
  textPatterns: {
    requestAttachment: string[];
    acceptSend: string[];
    loginRequired: string[];
    /** 消息卡片标题需包含其一，才视为「对方请求发附件简历」待同意 */
    resumeConsentCardIncludes: string[];
    /** 「点击预览附件简历」按钮文案需包含其一 */
    resumePreviewButtonIncludes: string[];
  };
  /** 与沟通巡检独立；默认由 `npm run recommend-greet` 一次性执行 */
  recommendGreet: RecommendGreetConfig;
};

export type ChatStateRecord = {
  messageSentAt?: string;
  attachmentRequestedAt?: string;
  attachmentReceivedAt?: string;
  lastPdfPath?: string;
  lastGeekName?: string;
};

export type StateFile = {
  chats: Record<string, ChatStateRecord>;
};
