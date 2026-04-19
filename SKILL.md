---
name: boss-assistant-patrol
description: Boss 招聘端自动化主 skill。覆盖沟通页巡检（发消息/收附件简历）与推荐页打招呼的可复现执行规范。
---

# Boss Assistant Skill

## 使用目标

用于指导其他 AI 在本仓库稳定复现两类任务：

- `npm run patrol`：沟通页巡检（未读识别 -> 身份校验 -> 消息/附件卡片处理）
- `npm run recommend-greet`：推荐牛人页一次性筛选并批量打招呼

## 执行优先级

1. 阻断式前置条件
2. 浏览器与风控硬规则
3. 本文件流程约束
4. `references/boss-chat-service.md`
5. `references/task-memory.md`

冲突时按高优先级执行。

## 阻断式前置条件（必须满足）

执行前必须满足：

1. 用户已在 Chrome 登录 Boss 招聘端。  
2. Chrome 以 `--remote-debugging-port=9222`（必要时加 `--user-data-dir=...`）启动。  
3. 仓库依赖已安装：`npm install`。  
4. 不在登录页或身份切换页（否则先让用户手动处理）。

任一条件不满足，禁止自动执行点击/发送动作。

## 浏览器与风控硬规则

1. 只复用用户当前已登录 tab，不新建 Boss 登录上下文。  
2. 默认优先 DOM + wapi + CDP，不走 OCR/图像识别路径。  
3. 发送或下载动作前必须确认在目标页面/目标会话上下文。  
4. 连续异常（例如连续 2 个会话切换失败）必须提前停止本轮，进入可恢复暂停态。  
5. 推荐页打招呼是一次性任务，不建议高频周期执行。

## 任务 A：沟通页巡检（`npm run patrol`）

目标页面：`https://www.zhipin.com/web/chat/index`

标准执行顺序：

1. 拉取会话列表（wapi），并与左侧红点匹配结果合并未读集合。  
2. 逐个打开会话并做身份校验（防止误发到其他人）。  
3. 若存在“对方想发送附件简历”卡片：  
   - 点击同意  
   - 点击“预览附件简历”  
   - 在预览弹窗点击下载图标  
   - 关闭弹窗  
4. 若不存在该卡片，且该会话尚未发过首条消息：发送 `autoMessageText`。  
5. 持久化状态到 `data/state.json`（时间戳、PDF 路径等）。

当前规则说明：

- 已移除“单轮处理条数上限”，默认会尝试轮完本轮未读集合。  
- 仍保留“连续 2 个会话切换失败即提前停止”保护。

### 附件简历 PDF（实现约定，排障必读）

**落盘位置**：巡检保存的简历 PDF 以 **`PatrolConfig.pdfDir`** 为准（默认仓库下 `bosspdf/`，可在 `config.json` 覆盖）。日志里 `已通过消息卡片下载简历: ...` 的路径才是权威结果；**不要**只在 Chrome 默认「下载」目录里找——同一轮可能仍有浏览器层面的多余条目。

**Boss 端行为（为何曾出现乱码 / UUID 无后缀）**：

1. **壳页 URL**：`download.url()` 或导航地址常为 `/bzl-office/pdf-viewer-*?url=<编码后的 /wflow/zpgeek/...>`。直接当 PDF 保存会得到 HTML，看起来像乱码。真实文件路径在查询参数 **`url=`** 解码后的 **`/wflow/...`** 上。  
2. **多次 `download` 事件**：一次点击可能先触发壳页/占位下载，再触发真 PDF。只绑定**第一个** `download` 会存错；实现上会在预览～收束窗口内收集多次事件，对临时文件校验 **`%PDF-`** 魔数，**优先选用真 PDF 那一次**，并对其余 `Download` 调用 **`cancel()`**，减轻 Chrome「近期下载」里 UUID、无扩展名噪音。  
3. **收束策略**：在「最后一次出现新的 `download` 事件」之后仅保留 **约数百毫秒** 的静默窗口（给紧挨着的第二档 PDF 留出时间），**一旦识别到 PDF 立即返回**，不做数秒级固定 sleep。  
4. **网络嗅探（辅助）**：预览/下载阶段监听 `zhipin.com` 上符合 `/wflow/`、`preview4boss` 等且响应体为 PDF 的响应，把 URL 记入列表；若落盘内容仍非 PDF，`patrol` 会用 **`page.request`** 按这些 URL 与壳页 `url=` 解包结果依次补救（带 `Referer`）。  
5. **文件名**：若浏览器建议的文件名无 **`.pdf`** 后缀（如 UUID），保存时会规范为以 **`.pdf`** 结尾。

**排障**：若保存失败并生成 `*.not-pdf.txt`，把该文件前若干字符与当次日志一并用于判断是否登录失效、接口 JSON、或 Boss 又改版 URL 形态。

## 任务 B：推荐牛人打招呼（`npm run recommend-greet`）

目标页面：`https://www.zhipin.com/web/chat/recommend`

标准执行顺序：

1. 打开/切换到推荐牛人页（已在该页时避免重复重载）。  
2. 若 `recommendGreet.applyFilters=true`：打开筛选面板并按 `filterSteps` 顺序点击，最后确定。  
3. 在推荐列表中依次点击 `打招呼` 按钮，直到 `maxGreets` 上限或无可点项。  
4. 每次点击间隔使用随机 sleep（由 `betweenGreetsMinMs/MaxMs` 控制）。

说明：详细选择器策略与异常恢复见 `SKILL-recommend-greet.md`。

## 调试与排障

巡检调试（cmd）：

```cmd
set BOSS_DEBUG_FRIEND=1
npm run patrol
```

推荐页调试：

```cmd
npm run recommend-greet -- --max=10
```

重点日志：

- `DEBUG wapi`：接口是否拿到会话  
- `未读会话数`：未读规则是否命中  
- `开始处理会话`：是否卡在切会话  
- `身份校验未通过`：是否切错线程  
- `已通过消息卡片下载简历`：附件 PDF 已成功写入 **`pdfDir`**（以该路径为准）  
- `保存下载失败` / `*.not-pdf.txt`：内容非 PDF，按上文「附件简历 PDF」与 `not-pdf.txt` 排查  
- `尝试点击筛选入口`：推荐页筛选定位过程  
- `打招呼进度 x/y`：推荐页执行进度

## 失败处理模板（必须输出）

失败后必须进入“可恢复暂停态”，并告知用户：

1. 失败步骤  
2. 已尝试路径  
3. 可能原因  
4. 用户最小操作（例如保持页面、手动点中候选人、确认在推荐页）  
5. 如何恢复（再次运行 `npm run patrol` 或 `npm run recommend-greet`）
