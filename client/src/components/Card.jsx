import { isRedSuit, rankText, SUIT_LABEL } from '../lib.js'

// 单张扑克牌。card 为 null 或对象缺省时显示牌背。
export default function Card({ card, size = 'md', dim = false }) {
  const cls = [
    'card',
    `card-${size}`,
    card ? (isRedSuit(card.suit) ? 'red' : 'black') : 'back',
    dim ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (!card) return <div className={cls} aria-label="牌背" />

  return (
    <div className={cls} aria-label={`${rankText(card.rank)}${SUIT_LABEL[card.suit]}`}>
      <span className="card-rank">{rankText(card.rank)}</span>
      <span className="card-suit">{SUIT_LABEL[card.suit]}</span>
    </div>
  )
}
