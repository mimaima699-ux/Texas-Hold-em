# 🐺 Online Texas Hold'em

A browser Texas Hold'em game with room battles and medium-strategy AI.

- Server authoritative: all game logic runs server-side; the client only renders state
- Full rules: blinds, four betting streets, minimum raises, all-ins with side pots, split pots
- Medium-strategy AI: preflop hand strength, position play, pot odds, draw counting, semi-bluffing
- Realtime multiplayer: Socket.IO push, reconnect support, action countdowns

## Quick Start

```bash
npm install        # install dependencies (workspaces: server + client)
npm run dev        # start backend (:3001) and frontend dev server (:5173) together
```

Open http://localhost:5173, enter a nickname, create a room, add AI players and start.
Share the room code (or the `?r=CODE` link) with friends for multiplayer (2~9 players).

Production mode:

```bash
npm run build      # build the frontend into client/dist
npm start          # single process, visit http://localhost:3001 directly
```

## Testing

```bash
npm test           # unit tests (vitest): hand evaluator / pots / game engine
npm run dev:server # smoke test needs a running server
npm run smoke      # e2e smoke: create room + AI hands + chip conservation check
```

## Project Structure

```
server/src/
  index.js              Entry: Express (static hosting + room list) + Socket.IO
  room.js               Room layer: seats, game loop, action timers, AI scheduling, broadcasting
  config.js             Constants (port, timeouts, blinds, player limits)
  game/
    deck.js             Cards and shuffling
    handEvaluator.js    5~7 card hand evaluation (incl. A-5 wheel, royal flush)
    pot.js              Main pot / side pot splitting and awards
    gameEngine.js       Single-hand state machine (betting rounds, showdown, per-player views)
  ai/
    equity.js           Preflop strength / equity / draw estimation
    aiPlayer.js         AI decisions (preflop by strength & position, postflop by pot odds)
client/src/
  App.jsx               Connection & room session management (localStorage, auto-reconnect)
  components/           JoinScreen / RoomLobby / GameTable / Seat / Card / ActionBar
scripts/
  smoke.mjs             End-to-end smoke test
```

## Protocol (Socket.IO)

| Event (C→S) | Payload | Description |
|---|---|---|
| `room:create` | `{ name }` | Create and join a room |
| `room:join` | `{ roomId, name, playerId? }` | Join a room (`playerId` = reconnect) |
| `room:addBot` | — | Host adds an AI player |
| `game:start` | — | Host starts a game (all seats reset to the starting stack) |
| `game:action` | `{ type: 'fold'/'check'/'call'/'raise', amount? }` | Act; raise `amount` is the target total bet |
| `game:rebuy` | — | Rebuy the starting stack after busting |

After every state change the server pushes a personalized `state` event to each
connection (your hole cards are only sent to you; other players' cards are
face-down `[null, null]` until showdown).

## Configuration

See [server/src/config.js](server/src/config.js): port (`PORT` env var), action
timeouts, AI thinking delays, result display time, starting stack and blinds.

## Deploying to the Web (Render free tier)

This repo ships with [render.yaml](render.yaml):

1. Push this directory to a GitHub repository (public or private)
2. Sign up at [render.com](https://render.com) (GitHub login works)
3. Dashboard → **New + → Blueprint** → select the repo → **Apply**
4. Wait 2~3 minutes for the build, then you get a public `https://xxx.onrender.com` URL

Free tier notes:

- The service sleeps after 15 minutes without traffic; the next visit takes
  30~60 seconds to wake up (the page shows "reconnecting")
- 750 free instance-hours per month — plenty for personal use
- Rooms live in memory and are cleared when the service restarts (just create a new room)
