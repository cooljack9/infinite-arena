// 休整屏 · 成长自我选择（人格化核心：角色有意志，每 2 层 + Boss 层主动提出方向，玩家拍板）
// 方案 §2.2 / §2.4：原型决定「能长成什么」（期望 + 风格），随机只作用于具体选项与幅度。
// 拍板结果经 chooseGrowth 写入 HeroGrowth（由 makeAlly::applyGrowthPct 应用），真实影响战力，零 core 改动。
import { useState } from 'react';
import { useGame } from '../../game/state/store';
import {
  archetypeOf, ARCHETYPE_INFO, rollGrowthOption, scaleGrowthOption,
  shouldOfferGrowth, type GrowthOption, type GrowthArchetype,
} from '../../game/persona';
import type { HeroDef, PrimaryAttrs, GrowthStatKey } from '@arena/core/types';

const PK: Record<keyof PrimaryAttrs, string> = { con: '强壮', str: '力量', agi: '敏捷', int: '智力' };
const SK: Record<GrowthStatKey, string> = { hp: '生命', pDmg: '物伤', mDmg: '法伤', heal: '治疗' };

// 把选项基增益按原型乘子放大后，格式化为「强壮+2.6 生命+4%」这类展示串
function growthSummary(opt: GrowthOption, arch: GrowthArchetype, layer: number): string {
  const g = scaleGrowthOption(opt, arch, layer);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(g.primary ?? {}) as [keyof PrimaryAttrs, number][]) {
    if (v) parts.push(`${PK[k]}+${v}`);
  }
  for (const [k, v] of Object.entries(g.secondaryPct ?? {}) as [GrowthStatKey, number][]) {
    if (v) parts.push(`${SK[k]}+${v}%`);
  }
  return parts.join(' ');
}

export function GrowthChoicePanel() {
  const run = useGame((s) => s.run);
  const growthLog = useGame((s) => s.growthLog);
  const chooseGrowth = useGame((s) => s.chooseGrowth);
  const [picks, setPicks] = useState<Record<string, { opt: GrowthOption; rerolls: number }>>({});
  const [done, setDone] = useState<Set<string>>(new Set());

  if (!run) return null;
  if (!shouldOfferGrowth(run.layer, run.mode)) return null;

  const layer = run.layer;
  // 本层已通过 chooseGrowth 提交过的 uid（从 growthLog 反查，跨刷新保留）
  const committed = new Set(growthLog.filter((g) => g.layer === layer).map((g) => g.uid));
  const pending = run.team.filter((h) => !committed.has(h.uid) && !done.has(h.uid));
  if (pending.length === 0) return null;

  const pickOf = (h: HeroDef): { opt: GrowthOption; rerolls: number } =>
    picks[h.uid] ?? { opt: rollGrowthOption(h, layer), rerolls: 0 };

  const adopt = (h: HeroDef) => {
    const p = pickOf(h);
    const arch = archetypeOf(h);
    const growth = scaleGrowthOption(p.opt, arch, layer);
    chooseGrowth([{
      uid: h.uid, growth,
      log: { uid: h.uid, layer, optionId: p.opt.id, label: p.opt.label, archetype: arch, tags: p.opt.tags },
    }]);
    setDone((d) => new Set(d).add(h.uid));
  };

  const reroll = (h: HeroDef) => {
    const cur = pickOf(h);
    if (cur.rerolls >= 3) return;
    const next = cur.rerolls + 1;
    setPicks((p) => ({ ...p, [h.uid]: { opt: rollGrowthOption(h, layer * 31 + next), rerolls: next } }));
  };

  return (
    <div className="panel col" style={{ marginTop: 10, maxWidth: 760, width: '100%', borderColor: '#ffd24a55' }}>
      <div className="subtitle" style={{ textAlign: 'left', color: '#ffd24a' }}>
        ✨ 第 {layer} 层 · 成长抉择 — 角色主动提出方向，你来拍板
      </div>
      {pending.map((h) => {
        const p = pickOf(h);
        const arch = archetypeOf(h);
        const info = ARCHETYPE_INFO[arch];
        return (
          <div key={h.uid} style={{ border: `1px solid ${info.color}55`, borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: info.color, fontWeight: 800, fontSize: 12, border: `1px solid ${info.color}`, borderRadius: 6, padding: '1px 6px' }}>
                {info.cn}
              </span>
              <b>{h.personalName ?? h.name}</b>
              <span style={{ color: '#aaa', fontSize: 12 }}>{h.name}</span>
            </div>
            <div style={{ margin: '6px 0', fontStyle: 'italic', color: '#ddd' }}>「{p.opt.line}」</div>
            <div style={{ fontSize: 13 }}>
              ⟶ <b>{p.opt.label}</b>{' '}
              <span style={{ color: '#9f9' }}>{growthSummary(p.opt, arch, layer)}</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <button className="primary" style={{ padding: '2px 12px', marginRight: 6 }} onClick={() => adopt(h)}>
                采纳
              </button>
              <button style={{ padding: '2px 12px' }} disabled={pickOf(h).rerolls >= 3} onClick={() => reroll(h)}>
                换一个（{pickOf(h).rerolls}/3）
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
