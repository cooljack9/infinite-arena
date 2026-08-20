// 休整屏拆分后各子页共用的装备卡片与词条渲染（从原 Intermission 抽离）。
import { CSSProperties } from 'react';
import { Equipment, Rarity, Affix } from '@arena/core/types';
import { AFFIX_POOL, rarityName, equipDisplayName, eqStarMult } from '@arena/core/content/equipment';

export const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#cfcfcf',
  blue: '#4aa3ff',
  orange: '#ff9a3c',
  red: '#ff4d6d',
};

export const cardStyle = (e: Equipment): CSSProperties => ({
  border: `1px solid ${RARITY_COLOR[e.rarity]}`,
  borderRadius: 8,
  padding: '6px 8px',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 10px ${RARITY_COLOR[e.rarity]}22`,
  minWidth: 128,
  color: '#e8e8e8',
  fontSize: 12,
});

/** 词条一行：pct 用金色 + % 号，flat 用常规色。视觉上一眼分清两个结算区。 */
export function AffixLine({ a, mult }: { a: Affix; mult: number }) {
  const pct = a.mode === 'pct';
  const v = Math.round(a.value * mult);
  const neg = v < 0;
  return (
    <span style={{ color: neg ? '#ff6b6b' : pct ? '#ffd24a' : '#cfd6e4', marginRight: 6 }}>
      {AFFIX_POOL[a.key].name}{v >= 0 ? '+' : ''}{v}{pct ? '%' : ''}
    </span>
  );
}

export function EqCard({ e, onClick, actionLabel, disabled, extra }: {
  e: Equipment;
  /** 按钮（actionLabel）点击回调；卡片本身不直接响应点击，由调用方按需包裹 */
  onClick?: () => void;
  actionLabel?: string;
  disabled?: boolean;
  extra?: React.ReactNode;
}) {
  const mult = eqStarMult(e);
  return (
    <div style={cardStyle(e)}>
      <div style={{ color: RARITY_COLOR[e.rarity], fontWeight: 700 }}>{equipDisplayName(e)}</div>
      <div className="muted" style={{ marginTop: 2 }}>
        {rarityName(e.rarity)}
        {e.rarity === 'red' && <span style={{ color: '#ffd24a' }}> · {e.star ?? 1}★ ×{mult.toFixed(2)}</span>}
      </div>
      <div style={{ marginTop: 2 }}>
        {e.affixes.map((a: Affix, i: number) => <AffixLine key={i} a={a} mult={mult} />)}
      </div>
      {extra}
      {actionLabel && (
        <button
          className="primary"
          style={{ marginTop: 6, padding: '2px 8px', fontSize: 12 }}
          disabled={disabled}
          onClick={onClick}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
