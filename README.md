# 🐺 Texas Hold'em — Online Poker

A real-time, browser-based **Texas Hold'em** poker game. Host a room, invite up to 8 friends (or fill seats with AI), and play with fully server-authoritative rules, live chat, and room-sharing links.

- **Server authoritative** — all game logic, hand evaluation, and pot/side-pot
  splitting run on the server; the client only renders state
- **Full poker rules** — blinds, four betting streets, minimum raises, all-ins
  with side pots, split pots
- **Two AI tiers** — a medium-strategy heuristic AI *and* an optional
  LLM-powered AI (Ollama, vLLM, LM Studio, SiliconFlow, OpenRouter, DashScope)
  that falls back to the heuristic AI when the endpoint is unavailable
- **Real-time multiplayer** — Socket.IO pushes, auto-reconnect, action countdowns,
  and lobby rooms that can be shared via a code or link
- **Victory screen** — when a game ends, a settlement overlay crowns the champion
  and shows the final standings (rank, hands won, chips)
- **Spectator mode & rebuys** — join a full room to watch, or rebuy back in after
  busting; the host can kick players mid-game
- **Improved AI** — Monte Carlo equity, board texture / draw awareness, and an
  AI benchmark harness (`scripts/ai-benchmark.mjs`)

> 🔗 **Repository:** <https://github.com/mimaima699-ux/Texas-Hold-em>

---

## Screenshots / Demo

Open `http://localhost:5173`, enter a nickname, **Create Room**, add a couple of
AI players, and start the game. Share the room code (or the `?r=CODE` link) with
friends for multiplayer.

---

## Quick Start

```bash
npm install        # install dependencies (workspaces: server + client)
npm run dev        # start backend (:3001) and frontend dev server (:5173) together
```

Production mode (static frontend served by the Node process):

```bash
npm run build      # build the frontend into client/dist
npm start          # single process, visit http://localhost:3001 directly
```

## Testing

```bash
npm test           # unit tests (vitest): hand evaluator / pots / game engine / AI
npm run dev:server # start the server, then:
npm run smoke      # e2e smoke test — room + AI hands + chip conservation
node scripts/ai-benchmark.mjs   # AI win-rate vs baseline (optional)
```

---

## Project Structure

```
server/src/
  index.js              Entry: Express (static hosting + room list API) + Socket.IO
  room.js               Room layer: seats, game loop, action timers, AI scheduling,
                        lobby expiry, reveal window, chat
  config.js             Constants (port, timeouts, blinds, player limits)
  game/
    deck.js             Cards and shuffling
    handEvaluator.js    5-7 card hand evaluation (incl. A-5 wheel, Royal Flush)
    pot.js              Main pot / side pot splitting and awards
    gameEngine.js       Single-hand state machine (betting rounds, showdown,
                        per-player views)
  ai/
    equity.js           Preflop strength / equity / draw estimation
    aiPlayer.js         Heuristic AI (preflop by strength & position, postflop
                        by pot odds)
    llmPlayer.js        Optional LLM AI (OpenAI-compatible endpoints, graceful
                        fallback to heuristic AI)
client/src/
  App.jsx               Connection & room session management (localStorage,
                        auto-reconnect)
  components/           JoinScreen / RoomLobby / GameTable / Seat / Card /
                        ActionBar / ChatBox / VictoryScreen
  lib.js                Shared helpers (phase names, table layout, clock sync)
scripts/
  smoke.mjs             End-to-end smoke test
  room-test.mjs         Room lifecycle + chat test
  llm-test.mjs          Standalone LLM decision probe
  ai-benchmark.mjs      Heads-up AI win-rate benchmark vs a baseline (paired seeds)
```

---

## Protocol (Socket.IO)

| Event (C→S)     | Payload                                              | Description |
|-----------------|------------------------------------------------------|-------------|
| `room:create`   | `{ name, startingChips?, smallBlind?, bigBlind? }`   | Create and join a room |
| `room:join`     | `{ roomId, name, playerId? }`                        | Join a room (`playerId` = reconnect) |
| `room:addBot`   | —                                                    | Host adds an AI player |
| `room:kick`     | `{ targetId }`                                        | Host removes a player from the room |
| `game:start`    | —                                                    | Host starts a game (resets every seat to the starting stack) |
| `game:action`   | `{ type: 'fold'/'check'/'call'/'raise', amount? }`   | Act; raise `amount` is the target **total** bet |
| `game:rebuy`    | —                                                    | Rebuy the starting stack after busting |
| `game:reveal`   | —                                                    | Show your hand during the reveal window |
| `chat:send`     | `{ text }`                                           | Send a room chat message |
| `room:spectate` | `{ name }`                                           | Watch a full room as a spectator |
| `room:leave`    | —                                                    | Leave the room (or stop spectating) |

After every state change the server pushes a **personalized `state` event** to
each connection — your hole cards are only sent to you; other players' cards are
face-down `[null, null]` until they choose to reveal at showdown.

---

## Configuration

See [server/src/config.js](server/src/config.js): port (`PORT` env var), action
timeouts, AI thinking delays, LLM turn window, result display time, starting
stack and blinds, lobby expiry, and chat limits.

For LLM-powered AI, copy [.env.example](.env.example) to `.env` and set your
endpoint, model and key:

```env
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=qwen/qwen-2.5-7b-instruct:free
LLM_API_KEY=sk-or-v1-xxxxxxxx
```

The server probes the endpoint at startup. If it's unreachable, bots automatically
use the built-in heuristic AI — the table never stalls.

---

## Deploying to the Web

### Render (recommended free tier)

This repo ships with [render.yaml](render.yaml):

1. Push this directory to a GitHub repository (public or private)
2. Sign up at [render.com](https://render.com) (GitHub login works)
3. Dashboard → **New + → Blueprint** → select the repo → **Apply**
4. After 2-3 minutes you get a public `https://xxx.onrender.com` URL

Free-tier notes:

- The service sleeps after 15 minutes without traffic; the next visit takes
  30-60 seconds to wake up (the page shows "reconnecting")
- 750 free instance-hours per month
- Rooms live in memory and are cleared on restart (just create a new room)

### Railway

[railway.json](railway.json) configures a Nixpacks build. Import the repo into
Railway and it will build + start automatically (`/api/health` health check).

### Glitch

See [GLITCH.md](GLITCH.md) for step-by-step Glitch import instructions.

### Self-host on your machine (tunnel)

Share a game with friends over the internet from your own PC:

- **ngrok**: double-click `start-online.bat` — it starts the server and an ngrok
  tunnel, printing a public HTTPS link your friends can open.
- **Cloudflare Tunnel**: place your `cloudflared.exe` and
  `cloudflared-config.yml` in the `poker` folder (use
  [cloudflared-config.example.yml](cloudflared-config.example.yml) as a template)
  and run `start-cloudflared.bat`.

> Note: rooms are in-memory and cleared when the server restarts. Keep your PC
> on while others are playing.

---

## License

MIT
