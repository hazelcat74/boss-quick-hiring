# Browser Routing

## 硬规则

1. 只复用用户当前已登录 Boss tab。  
2. 不新建未登录 Boss 页面作为主执行路径。  
3. 所有动作前先确认当前 URL 在 `zhipin.com/web/chat`。  
4. 会话切换后必须做目标身份校验。

## 推荐路径

1. CDP 连接现有 Chrome  
2. `goto /web/chat/index`  
3. 拉取会话 API（`getBossFriendList`）  
4. 左侧列表点击 `.geek-item`  
5. 标题校验 -> 再执行消息动作

## 失败策略

- API 失败：降级 DOM 红点/列表读取  
- 切换失败：跳过当前候选人，不盲发  
- 登录失效：本轮暂停，提示用户重新登录

