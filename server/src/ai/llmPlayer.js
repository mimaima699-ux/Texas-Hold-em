// LLM-powered poker AI.
// Talks to any OpenAI-compatible /chat/completions endpoint:
// Ollama, vLLM, LM Studio, SiliconFlow, OpenRouter, DashScope ...
// Every failure (offline / timeout / unparseable / illegal answer) returns
// null and the caller falls back to the built-in heuristic AI (aiPlayer.decide),
// so the table never stalls.

import { CONFIG } from '../config.js'
import { equityVsRanges } from './equity.js'
import { estimateRangePct } from './aiPlayer.js'

let llmReady = false

const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const SUITS = { c: '♣', d: '♦', h: '♥', s: '♠' }
const cardText = (c) => `${RANKS[c.rank] ?? c.rank}${SUITS[c.suit]}`
const handText = (cards) => cards.map(cardText).join(' ')

export function llmEnabled() {
  return llmReady && !!CONFIG.LLM_BASE_URL && !!CONFIG.LLM_MODEL
}

// Probe the endpoint at startup; disable quietly when unreachable
export async function initLlm() {
  if (!CONFIG.LLM_BASE_URL || !CONFIG.LLM_MODEL) {
    console.log('[llm] disabled (LLM_BASE_URL / LLM_MODEL not configured)')
    return false
  }
  const base = CONFIG.LLM_BASE_URL.replace(/\/$/, '')
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 3000)
    const res = await fetch(`${base}/models`, { signal: ctl.signal, headers: authHeaders() })
    clearTimeout(t)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    llmReady = true
    console.log(`[llm] AI enabled: ${CONFIG.LLM_MODEL} @ ${CONFIG.LLM_BASE_URL}`)
    return true
  } catch (e) {
    llmReady = false
    console.log(`[llm] endpoint unreachable (${e.message}) — using heuristic AI instead`)
    return false
  }
}

function authHeaders() {
  return CONFIG.LLM_API_KEY ? { Authorization: `Bearer ${CONFIG.LLM_API_KEY}` } : {}
}

const SYSTEM_PROMPT = `You are a normal but action-friendly no-limit Texas Hold'em player: you play a fairly wide range and give action, but you still fold when you clearly should.

Decide with common sense:
- Preflop: fold only genuine trash (e.g. small offsuit cards with big gaps) against real raises; call or raise with any playable hand — pairs, suited connectors, two-broadway cards, and decent aces.
- Postflop: call when you have a made hand, a live draw, or the pot odds justify it. Fold when you have nothing and the bet is significant — don't pay off big bets with air.

Use the estimated equity vs the pot odds as your guide: fold when equity is well below the pot odds and you have no draw; call or raise when it is close or better. Mix in an occasional bluff, mostly against opponents who fold often.

Always reply with ONE JSON object only — no markdown, no extra words:
{"action":"fold"} or {"action":"check"} or {"action":"call"} or {"action":"raise","amount":N}
For "raise", amount is the TOTAL bet you raise TO (not the raise increment), and must be an integer within the allowed range given to you.`

function positionText(position) {
  if (position >= 0.75) return 'late (good position, act last)'
  if (position >= 0.4) return 'middle'
  return 'early (act first)'
}

// Compact per-opponent read for the prompt (percentages, rounded).
function readsFor(opp) {
  const p = opp?.profile
  if (!p || p.hands < 1) return 'no reads yet'
  const vpip = Math.round((p.vpip / p.hands) * 100)
  const pfr = Math.round((p.pfr / p.hands) * 100)
  const fold = p.facedBet > 0 ? `, folds-to-bet ${Math.round((p.foldedToBet / p.facedBet) * 100)}%` : ''
  return `VPIP ${vpip}%, PFR ${pfr}%${fold}`
}

function buildUserPrompt(ctx) {
  const { hole, community, toCall, currentBet, potSize, legal, position, bigBlind, smallBlind, stack, opponents = [] } = ctx
  const board = community.length ? handText(community) : '(pre-flop)'
  const potOdds = toCall > 0 ? `${Math.round((toCall / (potSize + toCall)) * 100)}%` : 'n/a'
  const options = ['fold']
  if (legal.check) options.push('check')
  if (legal.canCall) options.push(`call ${legal.call}`)
  if (legal.canRaise) options.push(`raise to any total in [${legal.raiseMin}, ${legal.raiseMax}]`)

  // Same range read as the heuristic AI, so the LLM sees the world the same way
  const active = opponents.filter((o) => !o.folded)
  const ranges = active.map(estimateRangePct)
  const equity = equityVsRanges(hole, community, ranges, { iterations: 300 })
  const equityLine = `Estimated equity vs this field: ${Math.round(equity * 100)}% (pot odds ${potOdds}).`

  return `No-Limit Texas Hold'em hand. Blinds ${smallBlind ?? Math.round(bigBlind / 2)}/${bigBlind}.
Your stack: ${stack}. Pot: ${potSize}.
Your hole cards: ${handText(hole)}
Board: ${board}
Your position: ${positionText(position)}.
${equityLine}
Opponents: ${
    opponents.length
      ? opponents.map((o) => `${o.name} (stack ${o.stack}, bet ${o.bet}, ${readsFor(o)}${o.folded ? ', FOLDED' : ''})`).join('; ')
      : 'unknown'
  }
Current highest bet on this street: ${currentBet}. You must put in ${toCall} more to call (pot odds: ${potOdds}).
Allowed replies: ${options.join(', ')}.
Reply with the single best action as JSON now.`
}

// Extract the first {...} JSON object from a (possibly fenced/noisy) reply
function extractJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, '')
  const match = cleaned.match(/\{[\s\S]*?\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// Validate the LLM answer against the current legal actions; null = unusable
function sanitize(raw, legal) {
  if (!raw || typeof raw.action !== 'string') return null
  const type = raw.action.toLowerCase().trim()

  if (type === 'fold') {
    // Never fold when checking is free — downgrade to check
    return legal.check ? { type: 'check' } : { type: 'fold' }
  }
  if (type === 'check') return legal.check ? { type: 'check' } : null
  if (type === 'call') return legal.canCall ? { type: 'call' } : legal.check ? { type: 'check' } : null
  if (type === 'raise' || type === 'bet' || type === 'all-in' || type === 'allin') {
    if (!legal.canRaise) return legal.canCall ? { type: 'call' } : legal.check ? { type: 'check' } : { type: 'fold' }
    const amount = Math.round(Number(raw.amount))
    if (!Number.isFinite(amount)) return { type: 'raise', amount: legal.raiseMin }
    return { type: 'raise', amount: Math.max(legal.raiseMin, Math.min(legal.raiseMax, amount)) }
  }
  return null
}

async function askLlm(ctx) {
  const base = CONFIG.LLM_BASE_URL.replace(/\/$/, '')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), CONFIG.LLM_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        model: CONFIG.LLM_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(ctx) },
        ],
        temperature: 0.7,
        max_tokens: 120,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text) throw new Error('empty response')
    return sanitize(extractJson(text), ctx.legal)
  } finally {
    clearTimeout(timer)
  }
}

// Ask the LLM for a decision. Returns a legal action object, or null when
// unavailable/failed (caller should fall back to the heuristic AI).
export async function llmDecide(ctx) {
  if (!llmEnabled()) return null
  try {
    return await askLlm(ctx)
  } catch (e) {
    console.log(`[llm] decision failed (${e.message}) — heuristic fallback`)
    return null
  }
}
