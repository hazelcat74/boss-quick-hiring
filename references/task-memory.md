# Task Memory

状态文件：`data/state.json`

按会话 key（优先 `securityId`）记录：

- `messageSentAt`：首条消息发送时间  
- `attachmentRequestedAt`：索要附件时间  
- `attachmentReceivedAt`：接收附件时间  
- `lastPdfPath`：最近保存路径  
- `lastGeekName`：最近候选人显示名

## 规则

1. 已有 `messageSentAt` 时，不重复发首条消息。  
2. 已有 `attachmentRequestedAt` 时，优先走接收流程。  
3. 下载成功后更新 `attachmentReceivedAt` 与 `lastPdfPath`。  
4. 失败不清空历史状态，只记录日志并下轮重试。

