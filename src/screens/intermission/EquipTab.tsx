// 休整屏 ·「穿戴」子页（需求 ①：装备穿戴拆为独立子页面 + 装备筛选）。
// 选择一名勇者 → 查看其 6 通用槽 → 从（已筛选的）背包里点选装备穿上；
// 支持「一键装备（全队 / 当前勇者）」。融合/商店各自为独立子页，见同目录。
import { useEffect, useState } from 'react';
import { useGame } from '../../game/state/store';
import { displayName } from '@arena/core/engine/unit';
import { EqCard } from './EqCard';
import { useEquipFilter } from './FilterBar';

// v1.8.3 卡死修复：背包无上限（打很多关装备无限积累），全量渲染会让安卓 WebView 主线程爆掉。
// 分页渲染，每页固定件数；筛选变化自动回第一页。
const INVENTORY_PAGE = 30;

export default function EquipTab() {
  const run = useGame((s) => s.run)!;
  const inventory = useGame((s) => s.inventory);
  const equipped = useGame((s) => s.equipped);
  const equipItem = useGame((s) => s.equipItem);
  const equipAll = useGame((s) => s.equipAll);
  const unequipItem = useGame((s) => s.unequipItem);

  const [heroIdx, setHeroIdx] = useState(0);
  const hero = run.team[Math.min(heroIdx, run.team.length - 1)];
  const heroEq = equipped[hero.uid] ?? [];
  const freeSlots = run.team.reduce((s, h) => s + Math.max(0, 6 - (equipped[h.uid] ?? []).length), 0);
  const heroFreeSlots = Math.max(0, 6 - heroEq.length);

  const { controls, filtered } = useEquipFilter(inventory);

  // v1.8.3 背包分页
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / INVENTORY_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * INVENTORY_PAGE, (safePage + 1) * INVENTORY_PAGE);
  useEffect(() => { setPage(0); }, [filtered]); // 筛选/背包变化 → 回第一页

  return (
    <div className="col" style={{ marginTop: 4 }}>
      {/* 穿戴目标选择 */}
      <div className="subtitle" style={{ marginTop: 0, textAlign: 'left' }}>穿戴目标</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {run.team.map((h, i) => (
          <button
            key={h.uid}
            className={i === heroIdx ? 'primary' : ''}
            style={{ padding: '3px 10px', fontSize: 12 }}
            onClick={() => setHeroIdx(i)}
          >
            {displayName(h)}
            {(h.star ?? 1) > 1 && <span style={{ color: '#ffd24a' }}> {(h.star ?? 1)}★</span>}
            （{(equipped[h.uid] ?? []).length}/6）
          </button>
        ))}
      </div>

      {/* 当前勇者 6 槽 */}
      <div className="subtitle" style={{ marginTop: 10, textAlign: 'left' }}>
        已穿戴 · {displayName(hero)}（{heroEq.length}/6）
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: 6 }).map((_, i) => {
          const e = heroEq[i];
          if (!e) {
            return (
              <div
                key={i}
                style={{ border: '1px dashed #555', borderRadius: 8, padding: '10px 14px', color: '#666', minWidth: 128 }}
              >
                空槽
              </div>
            );
          }
          return (
            <div key={i} style={{ cursor: 'pointer' }} onClick={() => unequipItem(hero.uid, e.id)} title="点击脱下">
              <EqCard e={e} />
              <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>点击脱下</div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="primary"
          style={{ padding: '3px 10px', fontSize: 12 }}
          disabled={inventory.length === 0 || freeSlots === 0}
          title={
            inventory.length === 0 ? '背包为空'
              : freeSlots === 0 ? '全队槽位已满'
                : `按评分从高到低，把背包装备分发给全队（共 ${freeSlots} 个空槽）`
          }
          onClick={() => equipAll()}
        >
          🎽 全队一键装备（空槽 {freeSlots}）
        </button>
        <button
          style={{ padding: '3px 10px', fontSize: 12 }}
          disabled={inventory.length === 0 || heroFreeSlots === 0}
          title={`把评分最高的装备优先塞满 ${displayName(hero)} 的 ${heroFreeSlots} 个空槽`}
          onClick={() => equipAll(hero.uid)}
        >
          ⭐ 只装备当前勇者（空槽 {heroFreeSlots}）
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          分发顺序按装备综合评分（品质 / 星级 / 词条）从高到低，空槽最多者优先
        </span>
      </div>

      {/* 背包（筛选 + 点选穿上） */}
      <div className="subtitle" style={{ marginTop: 12, textAlign: 'left' }} id="tut-inventory">
        背包 · 点选穿上到「{displayName(hero)}」
      </div>
      {controls}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }} id="tut-inventory-grid">
        {filtered.length === 0 && <span className="muted">背包为空，或筛选后无匹配装备（开箱 / 商店购入）</span>}
        {pageItems.map((e) => (
          <div key={e.id} style={{ cursor: 'pointer' }} onClick={() => equipItem(hero.uid, e.id)}>
            <EqCard e={e} />
            <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>点击穿上</div>
          </div>
        ))}
      </div>
      {/* v1.8.3 背包分页控件：打了很多关后背包可能数百件，一次渲染会卡死安卓 */}
      {totalPages > 1 && (
        <div className="row" style={{ gap: 6, marginTop: 8, alignItems: 'center' }}>
          <button
            className="tag"
            style={{ cursor: 'pointer', padding: '2px 10px' }}
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            ‹ 上一页
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            第 {safePage + 1}/{totalPages} 页（共 {filtered.length} 件）
          </span>
          <button
            className="tag"
            style={{ cursor: 'pointer', padding: '2px 10px' }}
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            下一页 ›
          </button>
        </div>
      )}
    </div>
  );
}
