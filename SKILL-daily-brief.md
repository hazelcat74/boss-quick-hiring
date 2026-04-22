---
name: boss-daily-brief
description: Boss直聘每日简历Brief工作流，自动拉取候选人、获取简历、AI汇总并创建飞书云文档。适用于任意AI助手。
---

# Boss Daily Brief 工作流

## 功能概览

一条指令，完成今天 Boss直聘 的全部招聘动作：

- 拉取候选人列表 - 获取今天的 Boss直聘 候选人
- 批量获取简历 - 自动获取候选人简历信息
- AI 汇总分析 - 按职位分组整理为 Markdown 格式
- 创建飞书云文档 - 将分析结果自动创建为飞书文档
- AI 初筛评级 - 对候选人进行智能评分和筛选
- 自动发索要简历消息 - 对合适的候选人发送消息
- 操作记录归档 - 将结果记录到飞书文档中

## 触发方式

在任意 AI 助手中说以下指令即可自动触发：

- 「帮我处理今天的 Boss直聘」
- 「做今天的简历 brief」
- 「拉一下直聘候选人」

## 前置条件

| 依赖 | 说明 | 安装方法 |
|------|------|----------|
| opencli | Boss直聘 CLI 工具 | npm install -g @jackwener/opencli |
| opencli Browser Bridge | Chrome 扩展，opencli 依赖 | 见 opencli GitHub 主页 |
| lark-cli | 飞书 CLI 工具 | 参考 lark-cli 文档 |
| Chrome 浏览器 | 已登录 Boss直聘招聘端 | — |

## 首次使用配置

### 飞书一次性授权

```bash
lark-cli auth login --scope "drive:drive:readonly docx:document:create docx:docx:document:write_only docx:document:readonly" 2>&1
```

打开命令输出中的链接完成飞书授权（只需做一次）。

## 工作流程

1. **执行 opencli boss chatlist** 获取候选人列表
2. **顺序获取简历**（使用 --verbose 模式，逐个执行）
3. **AI 整理 Markdown**（按职位分组）
4. **创建飞书云文档** 存储分析结果
5. **AI 初筛打分** 对每个候选人进行评级
6. **操作记录追加** 到飞书文档（优先约谈名单 + 不合适列表）

## 初筛评级标准

| 等级 | 含义 | 自动动作 |
|------|------|----------|
| ⭐⭐⭐⭐⭐ 强推 | 经验高度匹配，薪资合理 | 优先约谈 |
| ⭐⭐⭐⭐ 推荐 | 基本匹配，有明显亮点 | 优先约谈 |
| ⭐⭐⭐ 可约 | 部分匹配，需面试确认 | 可选择约谈 |
| ⭐⭐ 观望 | 匹配度弱 | 不操作 |
| ⭐ 不推荐 | 明显不合适 | 操作记录中列出 |
| ❌ 排除 | 完全不相关 | 操作记录中列出 |

## 常见问题

- **Q: opencli: command not found**
  **A: 运行 `npm install -g @jackwener/opencli` 安装。**

- **Q: Browser Extension is not connected**
  **A: 在 Chrome 中安装 opencli Browser Bridge 扩展并确认已连接。**

- **Q: Cookie 已过期**
  **A: 在 Chrome 中重新登录 Boss直聘招聘端（ `https://www.zhipin.com`），然后继续。**

- **Q: 飞书报 missing_scope 权限错误**
  **A: 重新运行首次使用配置中的一次性授权命令。**

- **Q: resume 命令触发页面跳转或报 Cookie 已过期**
  **A: 必须使用 --verbose 标志。不加时 opencli 会走触发页面跳转的路径导致 Cookie 失效。**

## 注意事项

- **权限要求**：需要飞书文档的创建和写入权限
- **网络连接**：需要稳定的网络连接以获取候选人信息
- **Chrome 登录**：必须在 Chrome 中登录 Boss直聘招聘端
- **Cookie 有效性**：如果 Cookie 过期，需要重新登录 Boss直聘

## 示例对话

### 示例 1：基本使用

```
用户：帮我处理今天的 Boss直聘
AI：好的，正在处理今天的 Boss直聘候选人...

1. 正在获取候选人列表...
2. 正在获取简历信息...
3. 正在整理分析结果...
4. 正在创建飞书云文档...
5. 正在进行 AI 初筛...

✅ 处理完成！
- 飞书文档： `https://bytedance.larkoffice.com/docx/xxx`
- 优先约谈：3 人
- 不合适：5 人
```

### 示例 2：指定文件夹

```
用户：做今天的简历 brief，保存到 "招聘汇总" 文件夹
AI：好的，正在处理并保存到 "招聘汇总" 文件夹...
```