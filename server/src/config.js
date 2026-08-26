// Global constants and default configuration
export const CONFIG = {
  PORT: Number(process.env.PORT) || 3001,
  // Action timeout for human players (ms)
  ACTION_TIMEOUT_MS: 30000,
  // Shortened timeout when the acting player has disconnected (ms)
  OFFLINE_ACTION_TIMEOUT_MS: 8000,
  // AI thinking delay range (ms) for a more natural pace
  AI_ACT_MIN_MS: 500,
  AI_ACT_MAX_MS: 2000,
  // Display time between end of a hand and the start of the next (ms).
  // This is also the reveal window — players can choose to show their hand here.
  HAND_END_PAUSE_MS: 8000,
  // Default room settings
  DEFAULT_STARTING_CHIPS: 1000,
  DEFAULT_SMALL_BLIND: 5,
  DEFAULT_BIG_BLIND: 10,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 9,
}
