// Quick check of the LLM AI: probes the endpoint and asks for one decision.
// Usage: node scripts/llm-test.mjs   (server deps not required)

import { initLlm, llmDecide } from '../server/src/ai/llmPlayer.js'

const legal = {
  fold: true,
  check: false,
  canCall: true,
  call: 25,
  toCall: 25,
  canRaise: true,
  raiseMin: 40,
  raiseMax: 985,
}

const ctx = {
  hole: [{ rank: 14, suit: 's' }, { rank: 13, suit: 's' }], // A♠ K♠
  community: [{ rank: 12, suit: 's' }, { rank: 7, suit: 'd' }, { rank: 3, suit: 's' }],
  toCall: 25,
  currentBet: 30,
  potSize: 75,
  legal,
  position: 0.8,
  bigBlind: 10,
  smallBlind: 5,
  stack: 985,
  opponents: [
    { name: 'Alice', stack: 1200, bet: 30, folded: false },
    { name: 'Bob', stack: 500, bet: 10, folded: true },
  ],
  rng: Math.random,
}

const ok = await initLlm()
if (!ok) {
  console.log('LLM not available — llmDecide would return null (heuristic fallback in game)')
}

for (let i = 1; i <= 3; i++) {
  const t0 = Date.now()
  const action = await llmDecide(ctx)
  const ms = Date.now() - t0
  console.log(`#${i} [${ms}ms] -> ${JSON.stringify(action)}`)
}
