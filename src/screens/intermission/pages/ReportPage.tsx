// 战报页 · 战后默认落点（v2.4.7 整备拆分 ①）。
// 信息组：突破/成长摘要（紧凑一行式）→ 成长三选一 → 战利品开箱 → 建议下一步（跳页锚点）。
import { useState } from 'react';
import { useGame } from '../../../game/state/store';
import { Chest } from '@arena/core/types';
import { displayName } from '@arena/core/engine/unit';
import { toast } from '../../../components/Toast';
import { GrowthChoicePanel } from '../GrowthChoicePanel';
import type { GuideTarget } from './types';

// v1.8.3 卡死修复沿用：箱子列表无上限时安卓 WebView 会爆主线程，最多渲染此数。
const MAX_CHESTS_SHOWN = 40;

const CHEST_VIEW: Record<string, { icon: string; label: string; color: string }> = {
  equip_normal: { icon: '📦', label: '普通装备', color: '#cfcfcf' },
  gold_small:   { icon: '💰', label: '少量金币', color: '#ffd24a' },
  equip_high:   { icon: '🔵', label: '高级装备', color: '#4aa3ff' },
  equip_rare:   { icon: '🟣', label: '稀有装备', color: '#ff4d6d' },
  gold_large:   { icon: '💎', label: '大量金币', color: '#7ee08a' },
};

const PK_CN: Record<string, string> = { con: '强壮', str: '力量', agi: '敏捷', int: '智力' };
const SK_CN: Record<string, string> = { hp: '生命', pDmg: '物伤', mDmg: '法伤', heal: '治疗' };
const fmtV = (v: number) => (Math.round(v * 10) / 10).toString();

export default function ReportPage({ onGuideTo }: { onGuideTo: (t: GuideTarget) => void }) {
  const run = useGame((s) => s.run)!;
  const gold = useGame((s) => s.gold);
  const inventory = useGame((s) => s.inventory);
  const pendingDrops = useGame((s) => s.pendingDrops);
  const equipped = useGame((s) => s.equipped);
  const shopStock = useGame((s) => s.shopStock);
  const discount = useGame((s) => s.discount)();
  const openDrop = useGame((s) => s.openDrop);
  const openDrops = useGame((s) => s.openDrops);
  const setFxBusy = useGame((s) => s.setFxBusy);
  const setFxBusyWaves = useGame((s) => s.setFxBusyWaves);
  const lastBreakthrough = useGame((s) => s.lastBreakthrough);
  const lastKillGains = useGame((s) => s.lastKillGains);

  // v3.2 开箱动画：正在开的箱子 id -> true（3s 动画掩盖后端延迟）
  const [opening, setOpening] = useState<Record<string, boolean>>({});

  const openAll = () => {
    const ids = pendingDrops.map((d) => d.id);
    if (ids.length === 0) return;
    const mark: Record<string, boolean> = {};
    for (const id of ids) mark[id] = true;
    setOpening(mark);            // 全部宝箱同时亮动画
    setFxBusyWaves('正在开启宝箱…', '已完成开启宝箱');
    openDrops(ids);
    setTimeout(() => { setOpening({}); setFxBusy(null); toast(`已开启 ${ids.length} 个宝箱`, 'ok'); }, 1250);
  };
  const openChest = (id: string) => {
    if (opening[id]) return;
    setOpening({ [id]: true });
    setFxBusyWaves('正在开启宝箱…', '已完成开启宝箱');
    openDrop(id);
    setTimeout(() => { setOpening({}); setFxBusy(null); toast('已开启宝箱', 'ok'); }, 1250);
  };

  // ── 「建议下一步」渐进引导：动作 = 跳转到对应页（v2.4.7 由切 tab 升级为切页）──
  const freeSlots = run.team.reduce((s, h) => s + Math.max(0, 6 - (equipped[h.uid] ?? []).length), 0);
  const shopCount = shopStock.equipment.length + shopStock.consumables.length;
  const cheapest = Math.min(
    ...[...shopStock.equipment, ...shopStock.consumables].map((s) => Math.round(s.basePrice * (1 - discount))),
    Infinity,
  );
  const fusable = inventory.filter((e) => e.rarity !== 'normal').length >= 2;
  const steps: { t: GuideTarget; icon: string; label: string }[] = [];
  if (freeSlots > 0 && inventory.length > 0) steps.push({ t: { page: 'gear', sub: 'equip' }, icon: '🎽', label: '一键装备' });
  if (shopCount > 0 && gold >= cheapest) steps.push({ t: { page: 'supply' }, icon: '🛒', label: '一键全买' });
  if (fusable) steps.push({ t: { page: 'gear', sub: 'forge' }, icon: '🔥', label: '可合成' });

  // ── 战后属性成长摘要（击杀者 100%~150%、助攻者 30%~50%）──
  const killGainsText = lastKillGains
    ? Object.entries(lastKillGains).map(([uid, g]) => {
        const h = run.team.find((t) => t.uid === uid);
        if (!h) return null;
        const pk = Object.entries(g.primary ?? {})
          .map(([k, v]) => `${PK_CN[k] ?? k}+${fmtV(v as number)}`).join(' ');
        const sk = Object.entries(g.secondaryPct ?? {})
          .map(([k, v]) => `${SK_CN[k] ?? k}+${fmtV(v as number)}%`).join(' ');
        return `${displayName(h)}：核心[${pk}] 二级[${sk}]`;
      }).filter(Boolean).join('　')
    : '';

  return (
    <div>
      {/* ── 战果摘要（紧凑条，替代原全局顶置横幅）── */}
      {lastBreakthrough && (() => {
        const bh = run.team.find((h) => h.uid === lastBreakthrough.heroUid)
          ?? run.team.find((h) => h.id === lastBreakthrough.heroId);
        return (
          <div
            className="tag"
            style={{
              color: '#7ee08a', borderColor: '#7ee08a55',
              whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.6, maxWidth: '100%',
            }}
          >
            ✨ 属性突破：{bh ? displayName(bh) : '勇者'} 的
            {{ con: '强壮', str: '力量', agi: '敏捷', int: '智力' }[lastBreakthrough.key]} +{lastBreakthrough.add}%
          </div>
        );
      })()}
      {killGainsText && (
        <div
          className="tag"
          style={{
            marginTop: lastBreakthrough ? 6 : 0, color: '#7ee08a', borderColor: '#7ee08a55',
            whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.6,
            maxWidth: '100%', textAlign: 'left',
          }}
        >
          ⚔ 战后成长：{killGainsText}
        </div>
      )}

      <GrowthChoicePanel />

      {/* ── 战利品 ── */}
      <div className="subtitle" style={{ marginTop: 10, textAlign: 'left' }}>战利品（点击开箱）</div>
      {pendingDrops.length === 0 ? (
        <div className="muted">暂无未开启的箱子</div>
      ) : (
        <>
          <button
            className="primary"
            style={{ alignSelf: 'flex-start', padding: '2px 10px' }}
            onClick={openAll}
            disabled={Object.keys(opening).length > 0}
          >
            {Object.keys(opening).length > 0 ? '🎁 开启中…' : `全部开启（${pendingDrops.length}）`}
          </button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {pendingDrops.slice(0, MAX_CHESTS_SHOWN).map((d: Chest) => {
              const v = CHEST_VIEW[d.reward];
              const isOpening = !!opening[d.id];
              return (
                <div
                  key={d.id}
                  className="loot"
                  onClick={() => openChest(d.id)}
                  style={{
                    borderColor: v.color,
                    opacity: isOpening ? 0.5 : 1,
                    animation: isOpening ? 'chest-open 0.6s ease-in-out infinite' : undefined,
                  }}
                  title={isOpening ? '开启中…' : '点击开箱'}
                >
                  {isOpening ? '✨' : v.icon} {isOpening ? '开启中…' : v.label}
                  <br /><span className="muted" style={{ fontSize: 11 }}>{isOpening ? '✦' : '?'}</span>
                </div>
              );
            })}
          </div>
          {pendingDrops.length > MAX_CHESTS_SHOWN && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              …还有 {pendingDrops.length - MAX_CHESTS_SHOWN} 个箱子未显示（点上方「全部开启」一次清空）
            </div>
          )}
        </>
      )}

      {/* ── 建议下一步（渐进引导 → 跳页）── */}
      <div id="tut-guide" className="guide">
        <div className="subtitle" style={{ marginTop: 0, textAlign: 'left', color: '#9fe8b4' }}>
          💡 建议下一步（按推荐顺序）
        </div>
        {steps.length === 0 ? (
          <div className="muted">装备已穿满、商店无货、无可合成件——直接前往下一层挑战吧。</div>
        ) : (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {steps.map((s, i) => (
              <button
                key={s.t.page + (s.t.sub ?? '') + i}
                style={{
                  padding: '4px 10px', fontSize: 12,
                  border: '1px solid #7ee08a', color: '#bff3c8', background: 'rgba(126,224,138,0.10)',
                }}
                onClick={() => onGuideTo(s.t)}
              >
                {i + 1}. {s.icon} {s.label} →
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
