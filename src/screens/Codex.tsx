// v2.10 游戏内图鉴（UX-6）——把原本「不可见」的内容（尤其 6 个零触发的特性）做成可浏览总览。
// 分区：英雄 / 职业 / 特性 / 遗物 / 增益（三选一）。数据全部来自 @arena/core/content/* 静态表，
// 不引入任何随机源，不影响战斗确定性。收集进度：标注「本局在队 ★」+ 各分区总数。
import { useState } from 'react';
import { useGame } from '../game/state/store';
import { HERO_BY_ID } from '@arena/core/content/heroes';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { TRAITS, type TraitDef } from '@arena/core/content/traits';
import { RELICS } from '@arena/core/content/relics';
import { PRE_BATTLE_POOL } from '@arena/core/content/talents';
import type { HeroDef, RelicDef, TalentDef } from '@arena/core/types';

type Tab = 'hero' | 'subclass' | 'trait' | 'relic' | 'talent';

export default function Codex({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('hero');
  const run = useGame((s) => s.run);
  const inTeam = new Set(run?.team.map((h) => h.id) ?? []);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'hero', label: `英雄 (${Object.keys(HERO_BY_ID).length})` },
    { id: 'subclass', label: `职业 (${Object.keys(SUBCLASS_INFO).length})` },
    { id: 'trait', label: `特性 (${Object.keys(TRAITS).length})` },
    { id: 'relic', label: `遗物 (${RELICS.length})` },
    { id: 'talent', label: `增益 (${PRE_BATTLE_POOL.length})` },
  ];

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 980, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        className="panel col"
        style={{ width: 460, maxWidth: '94vw', maxHeight: '88vh', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ alignItems: 'center' }}>
          <div className="title" style={{ fontSize: 17 }}>📖 图鉴</div>
          <button className="ghost" onClick={onClose}>关闭 ✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          全部可获取内容总览（含未解锁机制）。带 ★ 表示本局在队。
        </div>

        <div className="seg" role="tablist" aria-label="图鉴分区" style={{ marginTop: 8 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={'seg-btn' + (tab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 10, overflowY: 'auto', paddingRight: 4 }}>
          {tab === 'hero' && (
            <div className="card-grid">
              {Object.values(HERO_BY_ID).map((h: HeroDef) => {
                const info = SUBCLASS_INFO[h.subclass];
                const owned = inTeam.has(h.id);
                return (
                  <div key={h.id} className="card card--hero" style={{ borderColor: info.color }}>
                    <div style={{ color: info.color, fontWeight: 700 }}>{owned ? '★ ' : ''}{h.name}</div>
                    <div className="muted" style={{ marginTop: 2 }}>{info.cn}</div>
                    <div style={{ marginTop: 2, color: '#cfd6e4', fontSize: 11 }}>{h.trait}</div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'subclass' && (
            <div className="card-grid">
              {Object.entries(SUBCLASS_INFO).map(([id, info]) => (
                <div key={id} className="card" style={{ borderColor: info.color }}>
                  <div style={{ color: info.color, fontWeight: 700 }}>{info.cn}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {info.category} · 射程 {info.attackRange} · {info.damageType === 'physical' ? '物理' : info.damageType === 'magic' ? '魔法' : '混合'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'trait' && (
            <div className="card-grid">
              {Object.values(TRAITS).map((t: TraitDef) => (
                <div key={t.id} className="card">
                  <div style={{ fontWeight: 700 }}>{t.name}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{t.desc}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'relic' && (
            <div className="card-grid">
              {RELICS.map((r: RelicDef) => (
                <div key={r.id} className="card">
                  <div style={{ fontWeight: 700, color: '#ffd24a' }}>{r.name}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{r.desc}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'talent' && (
            <div className="card-grid">
              {PRE_BATTLE_POOL.map((c: TalentDef) => (
                <div key={c.id} className="card">
                  <div style={{ fontWeight: 700, color: '#c9b6ff' }}>{c.name}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
