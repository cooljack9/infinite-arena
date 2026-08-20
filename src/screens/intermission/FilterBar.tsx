// 休整屏三子页共用的装备筛选 + 排序（需求：三套子页面均有装备筛选）。
// 以 React Hook 形式提供：返回筛选项 UI（controls）与筛选后列表（filtered），
// 调用方只需渲染 controls 与 filtered，无需各自维护筛选状态。
import { useMemo, useState, ReactNode } from 'react';
import { Equipment, Rarity, AffixKey } from '@arena/core/types';
import { AFFIX_POOL, equipScore, QUALITY_LEVEL } from '@arena/core/content/equipment';

export type EquipSort = 'score' | 'rarity' | 'name';

const RARITY_ORDER: Rarity[] = ['normal', 'blue', 'orange', 'red'];
const RARITY_LABEL: Record<Rarity, string> = { normal: '白', blue: '蓝', orange: '橙', red: '红' };

const chk = (on: boolean): React.CSSProperties => ({
  cursor: 'pointer',
  padding: '2px 7px',
  fontSize: 11,
  borderRadius: 5,
  border: `1px solid ${on ? '#ffcc4d' : '#4a3a5a'}`,
  background: on ? 'rgba(255,204,77,0.16)' : 'transparent',
  color: on ? '#ffcc4d' : '#9a8fb0',
  userSelect: 'none',
});

export function useEquipFilter(items: Equipment[]) {
  const [rarities, setRarities] = useState<Set<Rarity>>(new Set());
  const [attrs, setAttrs] = useState<Set<AffixKey>>(new Set());
  const [sort, setSort] = useState<EquipSort>('score');

  const filtered = useMemo(() => {
    let out = items.filter((e) => rarities.size === 0 || rarities.has(e.rarity));
    if (attrs.size > 0) out = out.filter((e) => e.affixes.some((a) => attrs.has(a.key)));
    const sorted = [...out];
    if (sort === 'score') sorted.sort((a, b) => equipScore(b) - equipScore(a));
    else if (sort === 'rarity') sorted.sort((a, b) => QUALITY_LEVEL[b.rarity] - QUALITY_LEVEL[a.rarity] || equipScore(b) - equipScore(a));
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [items, rarities, attrs, sort]);

  const toggleRarity = (r: Rarity) =>
    setRarities((prev) => {
      const n = new Set(prev);
      n.has(r) ? n.delete(r) : n.add(r);
      return n;
    });
  const toggleAttr = (k: AffixKey) =>
    setAttrs((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const attrNames = [...attrs].map((k) => AFFIX_POOL[k].name).join('、');

  const controls: ReactNode = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
      <span className="tag" style={{ color: '#9a8fb0' }}>筛选：</span>
      {RARITY_ORDER.map((r) => (
        <span key={r} style={chk(rarities.has(r))} onClick={() => toggleRarity(r)}>
          {RARITY_LABEL[r]}
        </span>
      ))}
      <span style={{ width: 1, height: 16, background: '#4a3a5a', margin: '0 2px' }} />
      <span className="tag" style={{ color: '#9a8fb0' }}>含属性：</span>
      {Object.keys(AFFIX_POOL).map((k) => (
        <span key={k} style={chk(attrs.has(k as AffixKey))} onClick={() => toggleAttr(k as AffixKey)}>
          {AFFIX_POOL[k as AffixKey].name}
        </span>
      ))}
      <span style={{ width: 1, height: 16, background: '#4a3a5a', margin: '0 2px' }} />
      <span className="tag" style={{ color: '#9a8fb0' }}>排序：</span>
      {(['score', 'rarity', 'name'] as EquipSort[]).map((s) => (
        <span
          key={s}
          style={chk(sort === s)}
          onClick={() => setSort(s)}
        >
          {s === 'score' ? '评分' : s === 'rarity' ? '品质' : '名称'}
        </span>
      ))}
      {(rarities.size > 0 || attrs.size > 0) && (
        <span
          style={{ ...chk(false), color: '#ff8a8a', borderColor: '#ff8a8a' }}
          onClick={() => { setRarities(new Set()); setAttrs(new Set()); }}
        >
          清除{attrNames ? `（含 ${attrNames}）` : ''}
        </span>
      )}
      <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
        {filtered.length}/{items.length} 件
      </span>
    </div>
  );

  return { controls, filtered, rarities, attrs, sort };
}
