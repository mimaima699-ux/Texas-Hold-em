# 🐺 在线德州扑克

房间对战 + 中等策略 AI 的德州扑克网页游戏。

- 服务器权威：所有牌局逻辑在服务端运行，客户端只渲染状态
- 完整规则：盲注、四条街下注、最小加注、全下与边池、平局分池
- 中等策略 AI：起手牌强度、位置打法、底池赔率、听牌计数、半诈唬
- 实时对战：Socket.IO 推送，支持断线重连、行动倒计时

## 快速开始

```bash
npm install        # 安装依赖（workspaces：server + client）
npm run dev        # 同时启动后端(:3001)与前端开发服务器(:5173)
```

浏览器打开 http://localhost:5173 ，输入昵称创建房间，添加 AI 补位后即可开局。
把房间号（或 `?r=房间号` 链接）发给朋友即可多人对战（2~9 人）。

生产模式：

```bash
npm run build      # 构建前端到 client/dist
npm start          # 单进程启动，直接访问 http://localhost:3001
```

## 测试

```bash
npm test           # 单元测试（vitest）：牌型评估 / 底池边池 / 引擎状态机
npm run dev:server # 冒烟测试需先启动服务器
npm run smoke      # 端到端冒烟：建房 + AI 对战若干手 + 筹码守恒校验
```

## 目录结构

```
server/src/
  index.js              入口：Express（静态托管 + 房间列表）+ Socket.IO
  room.js               房间层：座位、对局循环、行动计时、AI 调度、广播
  config.js             常量配置（端口、超时、盲注、人数上限）
  game/
    deck.js             牌堆与洗牌
    handEvaluator.js    5~7 张牌型评估（含 A-5 顺、皇家同花顺）
    pot.js              主池 / 边池拆分与分配
    gameEngine.js       单手牌状态机（下注轮推进、摊牌结算、个性化视图）
  ai/
    equity.js           起手牌强度 / 胜率 / 听牌估算
    aiPlayer.js         AI 决策（翻牌前按强度与位置，翻牌后按赔率）
client/src/
  App.jsx               连接与房间会话管理（localStorage 持久化、自动重连）
  components/           JoinScreen / RoomLobby / GameTable / Seat / Card / ActionBar
scripts/
  smoke.mjs             端到端冒烟测试
```

## 通信协议（Socket.IO）

| 事件（C→S） | 参数 | 说明 |
|---|---|---|
| `room:create` | `{ name }` | 创建并加入房间 |
| `room:join` | `{ roomId, name, playerId? }` | 加入房间（带 playerId 为重连） |
| `room:addBot` | — | 房主添加一个 AI |
| `game:start` | — | 房主开局（所有座位筹码重置） |
| `game:action` | `{ type: 'fold'/'check'/'call'/'raise', amount? }` | 行动；raise 的 amount 为"加注到"的目标总额 |
| `game:rebuy` | — | 破产后重新买入初始筹码 |

服务器在每次状态变化后向每个连接推送个性化 `state` 事件
（自己的底牌只发给自己，他人手牌在摊牌前以牌背 `[null, null]` 表示）。

## 配置

见 [server/src/config.js](server/src/config.js)：端口（`PORT` 环境变量）、
行动超时、AI 思考延迟、结算展示时长、初始筹码与盲注等。

## 部署到公网（Render 免费版）

本仓库已包含 [render.yaml](render.yaml)，部署步骤：

1. 把本目录推送到 GitHub 仓库（公开或私有均可）
2. 注册 [render.com](https://render.com)（可直接用 GitHub 账号登录）
3. Dashboard → **New + → Blueprint** → 选中该仓库 → **Apply**
4. 等待构建完成（约 2~3 分钟），即可获得 `https://xxx.onrender.com` 公网地址

免费版说明：

- 15 分钟无访问会休眠，下次打开需等 30~60 秒唤醒（页面会显示"正在重连"）
- 单服务 750 小时/月免费额度，个人玩完全够用
- 房间数据在内存中，服务重启后房间清空（重新建房即可）
