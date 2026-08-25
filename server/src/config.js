// 全局常量与默认配置
export const CONFIG = {
  PORT: Number(process.env.PORT) || 3001,
  // 真人玩家每轮行动超时（毫秒）
  ACTION_TIMEOUT_MS: 30000,
  // 玩家掉线后轮到其行动时的缩短超时（毫秒）
  OFFLINE_ACTION_TIMEOUT_MS: 8000,
  // AI 思考延迟范围（毫秒），让出手节奏更自然
  AI_ACT_MIN_MS: 500,
  AI_ACT_MAX_MS: 2000,
  // 一手结束后到下一手开始之间的展示时间（毫秒）
  HAND_END_PAUSE_MS: 6000,
  // 房间默认配置
  DEFAULT_STARTING_CHIPS: 1000,
  DEFAULT_SMALL_BLIND: 5,
  DEFAULT_BIG_BLIND: 10,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 9,
}
