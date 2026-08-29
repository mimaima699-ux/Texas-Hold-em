// LLM-powered poker AI.
// Talks to any OpenAI-compatible /chat/completions endpoint:
// Ollama, vLLM, LM Studio, SiliconFlow, OpenRouter, DashScope ...
// Every failure (offline / timeout / unparseable / illegal answer) returns
// null and the caller falls back to the built-in heuristic AI (aiPlayer.decide),
// so the table never stalls.

import { CONFIG } from '../config.js'
import { equityVsRanges } from './equity.js'
import { estimateRangePct } from './aiPlayer.js'
import { PERSONAS, detectLang } from './personas.js'

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

// ---------------------------------------------------------------------------
// Chat banter. Two trigger sources, both routed through generateBanter:
//   1. A human sends a chat message → one or more bots reply, and their replies
//      can chain into a continuous conversation (each bot's line may trigger
//      further replies from other bots, with probability decaying by depth).
//   2. A bot wins or busts at hand end → its relationship partners react.
// Each line is generated in a persona's voice, seeded with that persona's real
// chat-log examples (few-shot) so Qwen mimics how the bot actually talks.
//
// `lang` is propagated through a whole chain from the originating human message
// (Chinese in → Chinese bots; English in → English bots). Event reactions use
// the room's last-known human language (default Chinese).
// ---------------------------------------------------------------------------

function banterSystemPrompt(persona, lang) {
  if (lang === 'en') {
    // Fully English prompt — a Chinese prompt biases the model toward Chinese
    // output, so the whole thing is written in English for English rooms.
    const examples = (persona.examplesEn || persona.examples).map((e) => `  - ${e}`).join('\n')
    return `You are a player at a Texas Hold'em poker table, named ${persona.name}.

Personality: ${persona.voiceEn || persona.voice}

This is how ${persona.name} actually talks. Mimic this exact tone, slang, word choice, length and emoji habit:
${examples}

Now say ONE line in ${persona.name}'s voice (trash talk / tease / follow-up / react). Follow on logically from what the previous speaker just said, like real chat.
Rules:
- Reply in ENGLISH ONLY. Never use any Chinese characters.
- Just one short line, like a chat message, max ~20 words.
- Output the line directly — no quotes, no JSON, no explanation, no "${persona.name}:".
- Swearing, mocking, abstract humor are all fine — stay in character.
- NEVER say the word "nb" — it is completely banned for you. Praise with "awesome"/"sick"/"great", mock with "idiot".
- Never use bracket emoji tags like [sob] [doge] — use real emoji (😭 🐶 😎) or kaomoji.
- You may riff on the current hand (the pot, the board) but NEVER name specific hole cards — yours or anyone's. Cards are secret until a hand is over. You may say vaguely "my hand is good/trash", but never "A♦ J♥".
- Never output JSON, bracketed arrays, or any structured text — just one natural line.`
  }
  const examples = persona.examples.map((e) => `  - ${e}`).join('\n')
  return `你是德州扑克桌上的一名玩家，叫 ${persona.name}。

你的人设：${persona.voice}

你平时在群里就是这么说话的，以下是你的真实发言样本，模仿这个语气、口癖、用词、长度和emoji习惯：
${examples}

现在你要用 ${persona.name} 的口吻说一句话（嘴炮/吐槽/接话/反应都可以），要顺着上一个说话的人的内容往下接，像真人聊天。
规则：
- 用中文回复。
- 只输出一句话，极短，像微信聊天那样，不要超过40个字/词。
- 直接输出内容，不要加引号、不要JSON、不要解释、不要"说：".
- 可以脏话、可以嘲讽、可以抽象，保持你的人设。
- 绝对不要用"nb"这个词（它是禁词，禁止出现）。夸人用"厉害/牛/强/可以"，嘲讽、骂人用"sb"，不要用"idiot"等英文骂人词。
- 用纯中文，不要夹杂英文扑克术语（如 preflop/flop/turn/river/bluff/all-in/blind），用中文说法（翻牌前/翻牌/转牌/河牌/虚张声势/全押/盲注）。
- 绝对不要用 [sob] [doge] [tear] 这种方括号表情标签，直接用 emoji（如 😭 🐶 😎）或颜文字。
- 可以结合当前牌局（底池、局面）调侃，但绝对不要说出你或任何人手里的具体牌——一手牌结束前，底牌是秘密。可以含糊地说"我牌不错/烂"，但不要报出"A♦ J♥"这样的具体牌。
- 不要输出 JSON、方括号数组或任何结构化文本，只输出一句自然话。`
}

// Map internal phase names to human-readable Chinese (English rooms keep the
// English term). Stops the model from echoing raw tokens like "preflop".
const PHASE_ZH = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌', handEnd: '结算' }
function gameContextLine(game, lang) {
  if (!game) return ''
  const L = lang === 'zh'
  const parts = []
  if (game.phase && game.phase !== 'handEnd') {
    const ph = L ? (PHASE_ZH[game.phase] || game.phase) : game.phase
    parts.push(L ? ('当前阶段：' + ph) : ('phase: ' + ph))
  }
  if (game.community && game.community.length) parts.push(L ? ('公共牌：' + game.community) : ('board: ' + game.community))
  if (game.yourHand) parts.push(L ? ('你手里的牌：' + game.yourHand) : ('your hand: ' + game.yourHand))
  if (game.pot != null) parts.push(L ? ('底池：' + game.pot) : ('pot: ' + game.pot))
  if (game.yourChips != null) parts.push(L ? ('你的筹码：' + game.yourChips) : ('your chips: ' + game.yourChips))
  if (!parts.length) return ''
  return L ? ('\n牌局信息：' + parts.join('，')) : ('\nGame: ' + parts.join(', '))
}

function banterUserPrompt({ botName, speakerName, speakerText, game, event, lang, addressed }) {
  const ctx = gameContextLine(game, lang)
  // When the speaker @-addressed this bot by name, the reply must actually
  // respond to what was said — not a generic trash-talk line.
  const addressNote =
    addressed && lang === 'zh'
      ? '\n（对方直接@了你，你的回复必须针对他说的内容正面回应，不要跑题、不要答非所问。）'
      : addressed
        ? '\n(They @-mentioned you directly — your reply must actually answer what they said, no dodging.)'
        : ''
  // Event reaction: a bot's partner just won / busted
  if (event) {
    if (lang === 'zh') {
      const action = event.type === 'win' ? '赢了这手牌' : '出局了'
      return event.subjectName + ' 刚刚' + action + '。用 ' + botName + ' 的口吻对 ' + event.subjectName + ' 说一句话（嘴炮/吐槽/安慰/嘲讽都可以，符合你的人设）。' + ctx + '\n\n直接输出：'
    }
    const action = event.type === 'win' ? 'just won the hand' : 'just busted out'
    return event.subjectName + ' ' + action + ". Say one line to " + event.subjectName + " in " + botName + "'s voice (trash talk / tease / comfort — stay in character)." + ctx + '\n\nReply directly:'
  }
  // Chat reply to what someone said
  if (lang === 'zh') {
    return speakerName + ' 说：' + speakerText + ctx + addressNote + '\n\n用 ' + botName + ' 的口吻回一句：'
  }
  return speakerName + ' said: ' + speakerText + ctx + addressNote + "\n\nReply in " + botName + "'s voice:"
}

// One raw LLM call for a banter line. Returns the cleaned text or null.
async function fetchBanterLine(persona, { speakerName, speakerText, game, event, lang, forceLang, addressed }) {
  const base = CONFIG.LLM_BASE_URL.replace(/\/$/, '')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), CONFIG.LLM_TIMEOUT_MS)
  try {
    const effLang = forceLang || lang
    const sys = banterSystemPrompt(persona, effLang)
    // A short reinforcing line so the model doesn't drift back to Chinese mid-
    // chain in English rooms (the small model forgets the language after a few
    // turns). Always present, not just on retry.
    const langReminder =
      effLang === 'en'
        ? 'Respond ONLY in English. Do not use any Chinese characters.'
        : '只用中文回复，不要出现任何英文句子。'
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        model: CONFIG.LLM_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: banterUserPrompt({ botName: persona.name, speakerName, speakerText, game, event, lang, addressed }) },
          { role: 'user', content: langReminder },
        ],
        temperature: 0.9,
        max_tokens: 80,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text) throw new Error('empty response')
    return cleanBanter(text, forceLang || lang)
  } finally {
    clearTimeout(timer)
  }
}

// Does `text` contain CJK characters?
const hasCJK = (text) => /[一-鿿]/.test(String(text))

// Generate one banter line. Returns a trimmed string, or null if the LLM is
// unavailable / fails / the reply is unusable. Enforces the room's language:
// if the model replies in the wrong language, retry once with a stronger push.
export async function generateBanter({ botIcon, speakerName, speakerText, game, lang = 'zh', event = null, addressed = false }) {
  if (!llmEnabled()) return null
  const persona = PERSONAS[botIcon]
  if (!persona) return null
  const opts = { speakerName, speakerText, game, event, lang, addressed }
  try {
    let line = await fetchBanterLine(persona, opts)
    if (!line) return null
    // 42 must never mention the "42"/"answer is 42" joke — strip any such phrase.
    if (botIcon === '🌲' && /42|answer\s+is|答案是/i.test(line)) {
      line = line.replace(/答案[是为是]*\s*42/g, '').replace(/the answer is 42/gi, '').replace(/answer is 42/gi, '').replace(/\b42\b/g, '').trim()
      if (!line || line.length < 2) return null
    }
    // Language enforcement: the small model often slips into the wrong language.
    if (lang === 'en' && hasCJK(line)) {
      // Retry once with a hard English-only nudge
      const retry = await fetchBanterLine(persona, { ...opts, forceLang: 'en' })
      if (retry && !hasCJK(retry)) return retry
      // Still mixed after retry — better silent than mixing languages
      return null
    }
    if (lang === 'zh' && !hasCJK(line)) {
      // Retry once with a hard Chinese-only nudge
      const retry = await fetchBanterLine(persona, { ...opts, forceLang: 'zh' })
      return retry || null
    }
    return line
  } catch (e) {
    console.log(`[llm] banter failed (${e.message})`)
    return null
  }
}

// Strip quotes / "name:" prefixes / fenced blocks the LLM sometimes wraps its
// reply in, and trim to a sane length. In Chinese rooms, also swap any leaked
// English poker slang / "idiot" for their Chinese equivalents so output stays
// pure colloquial Chinese.
const ZH_TERM_SWAPS = [
  [/\bpre-?flop\b/gi, '翻牌前'],
  [/\bflop\b/gi, '翻牌'],
  [/\bturn\b/gi, '转牌'],
  [/\briver\b/gi, '河牌'],
  [/\bshowdown\b/gi, '摊牌'],
  [/\bbluff\b/gi, '虚张声势'],
  [/\ball-?in\b/gi, '全押'],
  [/\b(?:big|small)\s*blind\b/gi, '盲注'],
  [/\bidiot\b/gi, 'sb'],
  [/\bpot\b/gi, '底池'],
]
function cleanBanter(raw, lang) {
  let t = String(raw).replace(/```(?:json)?/gi, '').trim()
  // If the model emitted a JSON array/object by mistake (e.g. '["uhan123",[]…'),
  // strip leading/trailing structured fragments and keep any natural sentence
  // in the middle; if it's pure JSON, drop it.
  if (/^\s*[\[{]/.test(t)) {
    const inner = t.replace(/^\s*[\[{]/, '').replace(/[\]}]\s*$/, '')
    // If anything readable survives, use it; otherwise discard
    t = /[一-鿿a-zA-Z]{4,}/.test(inner) ? inner.replace(/^["',]+|["',]+$/g, '') : ''
  }
  // Drop a leading "Name:" or "Name：" the model might prepend
  t = t.replace(/^[^：:]{1,12}[：:]\s*/, '')
  // Strip surrounding quotes
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('"') && t.endsWith('"'))) {
    t = t.slice(1, -1)
  }
  // Replace [sob]/[doge]/[tear]… bracket emoji tags with real emoji
  t = t
    .replace(/\[?sob\]?/gi, '😭')
    .replace(/\[?cry(?:ing)?\]?/gi, '😭')
    .replace(/\[?doge\]?/gi, '🐶')
    .replace(/\[?tear\]?/gi, '😢')
    .replace(/\[?laugh\]?/gi, '😂')
    .replace(/\[[^\]]{1,10}\]/g, (m) => {
      const inner = m.slice(1, -1).toLowerCase()
      if (/^(doge|sob|tear|cry|laugh|happy|sad|angry|cool|love)$/.test(inner)) return ''
      return m
    })
  // Chinese rooms: scrub leaked English poker terms + idiot → sb
  if (lang === 'zh') {
    for (const [re, rep] of ZH_TERM_SWAPS) t = t.replace(re, rep)
  }
  // Hard strip any concrete card notation (A♠, K♥, 7s, 10d, 9c …). Bots must
  // NOT name specific hole cards in chat — it's a poker rule violation and the
  // model invents them even when its own hand isn't in the prompt.
  // Two safe shapes only, so we never eat English words like "the"/"that":
  //   1) a numeric rank + suit letter/symbol (7s, 10d, 2♣) — unambiguous.
  //   2) an uppercase letter rank + suit SYMBOL (A♠ K♥ Q♦ J♣) — unambiguous.
  // We deliberately do NOT strip "As/Kd" (letter rank + letter suit) because
  // that would eat "the"/"that"/"as". A bare-case regex kept hitting "th".
  t = t.replace(/\b(?:10|[2-9])[shdc♠♥♦♣]/gi, '')
  t = t.replace(/\b[AKQJT][♠♥♦♣]/g, '')
  // Strip garbled tokens the small model sometimes emits: a slash followed by
  // random latin letters/digits (e.g. "/cardmarge", "/cardano") and any run of
  // 4+ consonant-only latin chars that aren't a real word.
  t = t.replace(/\/[a-zA-Z0-9]{2,}/g, '')
  // CamelCase gibberish tokens like "StringValue" (a real word + CamelCase run,
  // or two capitalized chunks glued together) — drop the second chunk on.
  t = t.replace(/\b[A-Z][a-z]{2,}[A-Z][a-zA-Z]+\b/g, (m) => {
    // keep if it's a known word like "OMG"; otherwise strip the glued tail
    return /^(OMG|True)$/.test(m) ? m : m.replace(/[A-Z][a-zA-Z]+$/, '')
  })
  // Latin words containing non-ASCII latin letters (š, ž, ı, â …) — the model's
  // spelling glitches like "štija", "apia". Strip the whole glitchy token.
  t = t.replace(/[A-Za-zÀ-Þ]*[ŠšŽžİıÀ-ÿ][A-Za-zÀ-Þ]*/g, '')
  // Stray bracket / angle / pipe glyphs the model glues out of nowhere (e.g.
  // "><![[]]><>"). Drop them. Lone '!' is kept (enthusiastic personas use it);
  // '~' and '_' are kept too (~_~ kaomoji).
  t = t.replace(/[<>\[\]|{}#^]+/g, '')
  // Chinese rooms: strip ANY stray latin run (2+ letters) the model glues into
  // a Chinese sentence — "ymi", "ynnist", "definitely", "StringValue" already
  // handled above. Keep only a small whitelist of loan slang (sb/bb/wc/omg),
  // otherwise short tokens like "ymi" were slipping past the old 4-letter rule.
  if (lang === 'zh') {
    const allow = /^(sb|bb|wc|omg|ok|lol|gg|true)$/i
    t = t.replace(/[a-zA-Z]{2,}/g, (m) => (allow.test(m) ? m : ''))
    t = t.replace(/\s*[，,]?\s+/g, ' ').trim()
  }
  // "nb" is banned for generated banter in every language (only preset lines may
  // use it per the host) — drop it wherever it sneaks through.
  t = t.replace(/\bnb\b/gi, '')
  t = t.replace(/\s+/g, ' ').trim()
  // If after cleanup the line is mostly latin garbage (no CJK and no common
  // english words), drop it rather than post gibberish.
  if (lang === 'zh' && !/[一-鿿]/.test(t) && !/\b(the|is|you|are|so|my|your|to|a|i)\b/i.test(t)) {
    return null
  }
  if (t.length > 100) t = t.slice(0, 100)
  return t || null
}

export function banterEnabled() {
  return llmEnabled()
}
