# Boss Chat Service

## 单会话执行顺序

1. 打开目标会话  
2. 身份校验（标题与目标姓名一致）  
3. 若存在“对方想发送附件简历”卡片 -> 同意 -> 预览 -> 下载 PDF -> 关闭预览  
4. 若不存在该卡片且未发首条消息 -> 发送 `autoMessageText`  
6. 写入状态文件（`data/state.json`）

## 风控约束

- 单会话失败立即跳过，继续下一条。  
- 连续 2 个会话切换失败时提前停止本轮。  
- 禁止在身份校验失败时发送消息。

## 按钮策略

发送按钮优先：

1. `.submit.active`  
2. `.submit`  
3. 文本“发送”的按钮/节点

附件卡片标题与预览按钮文本由配置中的 `textPatterns.resumeConsentCardIncludes` / `resumePreviewButtonIncludes` 控制。

