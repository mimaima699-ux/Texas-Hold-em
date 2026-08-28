// Global constants and default configuration
export const CONFIG = {
  PORT: Number(process.env.PORT) || 3001,
  // Action timeout for human players (ms)
  ACTION_TIMEOUT_MS: 30000,
  // Shortened timeout when the acting player has disconnected (ms)
  OFFLINE_ACTION_TIMEOUT_MS: 8000,
  // Turn window for a human in AFK mode — short, then auto-folds
  AFK_TURN_MS: 5000,
  // AI thinking delay range (ms) for a more natural pace
  AI_ACT_MIN_MS: 500,
  AI_ACT_MAX_MS: 2000,
  // LLM-powered AI: any OpenAI-compatible endpoint. Endpoint unreachable
  // or unset → the heuristic AI (aiPlayer.js) is used automatically.
  // Local Ollama / vLLM / LM Studio / SiliconFlow / OpenRouter / DashScope all work.
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  LLM_MODEL: process.env.LLM_MODEL || 'qwen2.5:7b',
  LLM_API_KEY: process.env.LLM_API_KEY || '', // not needed for local services
  LLM_TIMEOUT_MS: Number(process.env.LLM_TIMEOUT_MS) || 12000, // per-request timeout
  // Visible turn window for LLM bots (they need a few seconds to think)
  LLM_TURN_MS: Number(process.env.LLM_TURN_MS) || 14000,
  // Display time between end of a hand and the start of the next (ms).
  // This is also the reveal window — players can choose to show their hand here.
  HAND_END_PAUSE_MS: 8000,
  // Default room settings
  DEFAULT_STARTING_CHIPS: 100,
  DEFAULT_SMALL_BLIND: 5,
  DEFAULT_BIG_BLIND: 10,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 9,
  // Hard cap on rebuys a host may grant (chosen at create; room default is 0).
  MAX_REBUYS: 10,
  // A lobby room that never starts a game is auto-closed after this long (ms).
  // Empty never-started rooms survive until this deadline (a page refresh
  // won't kill the invite link); rooms where a game has started close as
  // soon as the last human leaves.
  ROOM_LOBBY_EXPIRE_MS: Number(process.env.ROOM_LOBBY_EXPIRE_MS) || 3 * 60_000,
  // Chat: per-player message cooldown (ms) and max length
  CHAT_COOLDOWN_MS: 400,
  CHAT_MAX_LEN: 120,
}
