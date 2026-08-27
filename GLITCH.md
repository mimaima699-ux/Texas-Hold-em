# Deploying to Glitch (free cloud hosting)

## Why Glitch

This game is built on **Node.js + Socket.IO (WebSocket long connections)**, so it
needs a server that can run a **persistent Node process**. Glitch fits the bill:

- Free, **no credit card required**
- Supports WebSockets
- Gives you a permanent URL `https://<project-name>.glitch.me` (it will go to
  sleep — see the notes below)

## Step 1: Put the code in a Git repository

Glitch imports from a Git repository. If GitHub is slow from your region, you
can use **Gitee** as an alternative.

From the `poker` directory (make sure `.gitignore` excludes `node_modules` and
`client/dist`):

```bash
git init
git add .
git commit -m "poker game"
git remote add origin <your-repo-url>
git push -u origin main
```

## Step 2: Import into Glitch

1. Open [glitch.com](https://glitch.com) and sign up / log in (GitHub or email
   login both work)
2. **New Project -> Import from GitHub**
3. Paste your repository URL (for Gitee, you can also `git clone` directly from
   the Glitch terminal)
4. Glitch will auto-detect it as a Node project and run `npm install` +
   `npm start`
   - Our `npm start` is already configured to "build the frontend, then start
     the server"
5. After 1-2 minutes, click **Share** at the top to get
   `https://<project-name>.glitch.me`

## No Git repository (manual upload)

1. New Project -> choose **hello-node**
2. Delete the default files and upload your project files one by one
   (`package.json`, `server/`, `client/`, etc.) — **do not upload `node_modules`**.
   You can also create them in the left file tree and paste the contents in.
3. In the Glitch terminal at the bottom, run `npm install`, then click
   **refresh**

> Running `npm run build` locally first and uploading `client/dist` along with
> everything else skips the build step on Glitch.

## Notes

- **Sleeping**: the project goes to sleep after 5 minutes without visits. The
  next visit will take a few seconds to wake up (the page will show
  "reconnecting").
- **Rooms are in-memory**: rooms are cleared when the service restarts, so you
  will need to create a new one.
- **Port**: you don't need to worry about ports — the server already reads
  `process.env.PORT` (which Glitch injects automatically).
- The free tier is more than enough for personal play.
