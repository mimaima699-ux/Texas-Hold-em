# 部署到 Glitch（免费云托管）

## 为什么选 Glitch

这个游戏是 **Node.js + Socket.IO（WebSocket 长连接）**，需要一台能跑**常驻 Node 进程**的服务器。
Glitch 正好满足：

- 免费、**无需信用卡**
- 支持 WebSocket
- 给你一个永久网址 `https://<项目名>.glitch.me`（会休眠，见下方注意）

## 第一步：把代码放到 Git 仓库

Glitch 从 Git 仓库导入。国内访问 GitHub 慢的话，可以用 **Gitee（码云）** 代替。

在 `poker` 目录里（确保 `.gitignore` 已排除 `node_modules`、`client/dist`）：

```bash
git init
git add .
git commit -m "poker game"
git remote add origin <你的仓库地址>
git push -u origin main
```

## 第二步：导入 Glitch

1. 打开 [glitch.com](https://glitch.com)，注册/登录（GitHub 或邮箱都行）
2. 右上角 **New Project → Import from GitHub**
3. 粘贴你的仓库地址（Gitee 的话在 Glitch 终端里 `git clone` 也行）
4. Glitch 会自动识别为 Node 项目，执行 `npm install` + `npm start`
   - 我们的 `npm start` 已配置为「先构建前端，再启动服务器」
5. 等 1~2 分钟，点顶部 **Share**，拿到网址 `https://<项目名>.glitch.me`

## 没有 Git 仓库（手动上传）

1. New Project → 选 **hello-node**
2. 删掉默认文件，把项目文件（`package.json`、`server/`、`client/` 等，**不要上传 `node_modules`**）逐个上传 / 在左侧文件树新建并粘贴
3. 在 Glitch 底部终端执行 `npm install`，然后点 **refresh**

> 本地先跑一次 `npm run build`，把 `client/dist` 一起传上去，可以省去 Glitch 上的构建步骤。

## 注意事项

- **休眠**：5 分钟没访问会休眠，下次访问等几十秒自动唤醒（页面会显示 reconnecting）
- **房间是内存态**：服务重启后房间清空，需要重新建房
- **端口不用管**：服务器已经读 `process.env.PORT`（Glitch 自动注入）
- 免费额度对个人开黑完全够用
