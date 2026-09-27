// 补给页（v2.4.7 整备拆分 ③）。
// 信息组：商店货架（ShopTab 原样复用）→ 英雄招募。招募刷新/招募动画状态由本页自持。
import { useState } from 'react';
import { useGame } from '../../../game/state/store';
import { HeroDef } from '@arena/core/types';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { HERO_BY_ID } from '@arena/core/content/heroes';
import { recruitCostOf } from '@arena/core/rules/economy';
import ShopTab from '../ShopTab';

export default function SupplyPage({ onOpenPanel }: { onOpenPanel: (hero: HeroDef, preview?: any[]) => void }) {
  const run = useGame((s) => s.run)!;
  const gold = useGame((s) => s.gold);
  const recruitPool = useGame((s) => s.recruitPool);
  const recruit = useGame((s) => s.recruit);
  const refreshRecruit = useGame((s) => s.refreshRecruit);
  const setFxBusy = useGame((s) => s.setFxBusy);
  const setFxBusyWaves = useGame((s) => s.setFxBusyWaves);

  // v3.2c 招募刷新动画（3s 悬浮提示 + 锁全局交互，防连点刷新）
  const [recruitRefreshing, setRecruitRefreshing] = useState(false);
  // v3.3b 招募动画：恭喜主公新获一员大将
  const [recruiting, setRecruiting] = useState(false);

  return (
    <div>
      {/* ── 商店货架（原 ShopTab 零改动复用）── */}
      <ShopTab />

      {/* ── 英雄招募 ── */}
      <div className="row between" style={{ marginTop: 14, alignItems: 'center' }}>
        <div className="subtitle" style={{ margin: 0, textAlign: 'left' }}>
          英雄商店 · 队伍 {run.team.length}/7
        </div>
        <button
          style={{ padding: '2px 10px', fontSize: 12 }}
          disabled={gold < 1 || recruitRefreshing}
          onClick={() => {
            if (recruitRefreshing) return;
            setRecruitRefreshing(true);
            setFxBusyWaves('正在招募新的志愿者，请稍等', '已完成招募刷新');
            refreshRecruit();
            setTimeout(() => { setRecruitRefreshing(false); setFxBusy(null); }, 1250);
          }}
          title="花 1 金币重新随机招募池"
        >
          {recruitRefreshing ? '🔄 招募中…' : '🔄 刷新 (1💰)'}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        购买英雄 = 再招募一份副本（可上场多个同名角色）；升星 / 突破请在该角色的「面板」中点「升星」。不需要的副本可到「队伍」页点其「✕」出售。
      </div>
      {recruitPool.length === 0 ? (
        <div className="muted" style={{ marginTop: 4 }}>本层暂无可招募勇者</div>
      ) : (
        <div className="card-grid">
          {recruitPool.map((h) => {
            const info = SUBCLASS_INFO[h.subclass];
            // v1.7 每英雄价格按其基础值相对预设的偏离浮动（贵≠一定强）
            const cost = recruitCostOf(run.layer, h.basePrimary, HERO_BY_ID[h.id].basePrimary);
            const owned = run.team.some((t) => t.id === h.id);
            const full = run.team.length >= 7;
            const can = gold >= cost && !full;
            const label = full ? '队伍已满' : owned ? `招募副本 ${cost}` : `招募 ${cost}`;
            const panelHero = owned ? run.team.find((t) => t.id === h.id) ?? h : h;
            return (
              <div
                key={h.id}
                className="card card--hero"
                style={{ borderColor: info.color, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 10px ${info.color}22` }}
              >
                <div style={{ color: info.color, fontWeight: 700 }}>{h.name}</div>
                <div className="muted" style={{ marginTop: 2 }}>{info.cn}{owned ? ' · 已有副本' : ''}</div>
                <div style={{ marginTop: 2, color: '#cfd6e4', fontSize: 11 }}>{h.trait}</div>
                <div className="row" style={{ gap: 4, marginTop: 6 }}>
                  <button
                    className="primary"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    disabled={!can || recruiting}
                    onClick={() => {
                      if (recruiting) return;
                      setRecruiting(true);
                      setFxBusyWaves('恭喜主公新获一员大将', `${h.name}誓死追随主公！`);
                      recruit(h.id);
                      setTimeout(() => { setRecruiting(false); setFxBusy(null); }, 1250);
                    }}
                  >
                    {recruiting ? '✨ 招募中…' : label}
                  </button>
                  <button
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={(ev) => { ev.stopPropagation(); onOpenPanel(panelHero); }}
                  >
                    📊 面板
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
