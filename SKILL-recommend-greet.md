---
name: boss-recommend-greet
description: Boss 推荐牛人页一次性批量打招呼 skill。用于稳定复现「打开筛选 -> 应用条件 -> 依次点打招呼」流程。
---

# Boss 推荐牛人 — 批量打招呼 Skill

## 使用目标

用于指导 AI 在推荐页稳定执行：

- 可选筛选（按配置顺序点击）
- 批量点击「打招呼」
- 记录进度并在异常时可恢复退出

不包含沟通页巡检、会话内发话术、附件简历下载（这些归 `SKILL.md` / `npm run patrol`）。

## 执行优先级

1. 阻断式前置条件  
2. 页面与风控硬规则  
3. 本文件执行流程  
4. `SKILL.md` 与 `README.md` 补充说明

冲突时按高优先级执行。

## 阻断式前置条件（必须满足）

1. 用户已在 Chrome **登录 Boss 招聘端**。  
2. Chrome 以 `--remote-debugging-port=9222` 启动（可带 `--user-data-dir`）。  
3. 仓库已 `npm install`。  
4. 当前可访问 `https://www.zhipin.com/web/chat/recommend`。  
5. 不与 `patrol` 并发执行（避免抢同一 tab）。

任一条件不满足，禁止执行自动点击。

## 页面与风控硬规则

1. 只复用用户当前已登录 Chrome 上下文（CDP），不新建登录态。  
2. 推荐页任务是一次性手动触发，不建议周期任务。  
3. 对筛选项缺失、按钮不可见、列表到底等情况允许跳过并继续，不做暴力重试。  
4. 所有自动点击都应有短随机间隔，避免高频固定节奏。

## 执行入口

```bash
npm run recommend-greet
```

可选参数：

- `--max=60`：覆盖配置里的最大打招呼次数。  
- `--no-filters`：不点筛选，仅对当前列表打招呼。

日志：`data/logs/recommend-greet-<时间戳>.log`

## 标准执行流程

1. 打开/切换到推荐牛人页。  
2. 若 `applyFilters=true`：打开筛选面板并按 `filterSteps` 顺序点击，最后点确定。  
3. 定位推荐列表中的 `打招呼` 按钮，逐条点击并累计进度。  
4. 达到 `maxGreets` 或无可点击项时结束并写日志。

## 配置项（`config.json -> recommendGreet`）

| 字段 | 含义 |
|------|------|
| `recommendUrl` | 推荐页 URL，默认官方推荐牛人地址 |
| `maxGreets` | 打招呼次数上限 |
| `applyFilters` | 是否在打招呼前执行筛选流程 |
| `filterSteps` | 依次点击：`{ "type": "option", "text": "985" }` 或 `{ "type": "firstDegreeCheckbox" }` |
| `betweenGreetsMinMs` / `betweenGreetsMaxMs` | 每次点击间隔随机区间，降低风控感 |

`cdpUrl`、`logDir`、`textPatterns.loginRequired` 与巡检共用根配置。

## DOM 策略（Boss 改版时优先检查）

- 打开筛选：先试 `.recommend-filter.op-filter .filter-label` 文案 **筛选**；若无反应再点 `.filter-arrow-down svg`（或整块 `.filter-arrow-down`）；仍不行则点筛选条容器一次。  
- 筛选项：`div.option` 精确匹配文案（如 `985`、`在职-月内到岗`）。  
- 第一学历：`.filter-panel .first-degree-wrap span.check-box`。  
- 确定：`.filter-panel div.btns div.btn` 文案 **确定**。  
- 打招呼：`#recommend-list button.btn-greet`（或 `button.btn.btn-greet`）且含「打招呼」。

## 关键日志（排障优先看）

- `当前 URL`：确认路由正确。  
- `等待筛选条挂载` / `尝试点击筛选入口`：筛选定位过程。  
- `筛选面板已打开`：筛选阶段成功。  
- `打招呼进度 x/y`：执行进度。  
- `列表滚动多次仍无可点`：通常表示到底或按钮状态已变。

## 失败处理模板（必须输出）

失败时按以下格式回复用户：

1. 失败步骤  
2. 已尝试路径（selector / 页面判断）  
3. 可能原因  
4. 用户最小操作（如关闭遮挡弹窗、手动进入推荐页）  
5. 如何恢复（再次运行 `npm run recommend-greet`，必要时附 `--no-filters`）
