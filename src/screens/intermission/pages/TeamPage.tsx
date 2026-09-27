// 队伍页（v2.4.7 整备拆分 ②）。
// 信息组：英雄卡（面板/出售/星级/装备位）→ 一次性药剂。出售确认弹层由本页自持。
import { useState } from 'react';
import { useGame } from '../../../game/state/store';
import { HeroDef } from '@arena/core/types';
import { displayName } from '@arena/core/engine/unit';
import { CONSUMABLE_CFG } from '@arena/core/content/consumables';
import ConfirmDialog from '../../ConfirmDialog';

export default function TeamPage({ onOpenPanel }: { onOpenPanel: (hero: HeroDef, preview?: any[]) => void }) {
  const run = useGame((s) => s.run)!;
  const equipped = useGame((s) => s.equipped);
  const consumables = useGame((s) => s.consumables);
  const sellHero = useGame((s) => s.sellHero);
  const useConsumable = useGame((s) => s.useConsumable);
  const recruitCost = useGame((s) => s.recruitCost)();

  const [useTarget, setUseTarget] = useState<Record<string, string>>({});
  const [sellConfirm, setSellConfirm] = useState<HeroDef | null>(null);

  return (
    <div>
      {/* ── 队伍：面板 / 出售（教学锚点原位保留）── */}
      <div className="subtitle" style={{ marginTop: 0, textAlign: 'left' }}>队伍 · 面板 / 出售</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {run.team.map((h, i) => (
          <span key={h.uid} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <button
              className="primary"
              style={{ padding: '2px 10px' }}
              onClick={() => onOpenPanel(h)}
            >
              {displayName(h)}
              {(h.star ?? 1) > 1 && <span style={{ color: '#ffd24a' }}> {(h.star ?? 1)}★</span>}
              {h.pendingBurst && <span style={{ color: '#ff9a3c' }} title="爆发药剂生效中">⚡</span>}
              （{(equipped[h.uid] ?? []).length}/6）
            </button>
            <button
              id="tut-hero-panel"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={(ev) => { ev.stopPropagation(); onOpenPanel(h); }}
            >
              📊 面板
            </button>
            <button
              id={i === 0 ? 'tut-hero-sell' : undefined}
              style={{ padding: '2px 6px', fontSize: 10, color: '#ff8a8a' }}
              disabled={run.team.length <= 1}
              title={run.team.length <= 1 ? '至少保留 1 名勇者' : `出售此副本（返还 ${Math.round(recruitCost * 0.8)} 金币）`}
              onClick={() => setSellConfirm(h)}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      {/* ── 一次性药剂 ── */}
      <div className="subtitle" style={{ marginTop: 14, textAlign: 'left' }}>一次性药剂（已购买）</div>
      {consumables.length === 0 ? (
        <div className="muted">尚未持有药剂（商店有 20% 概率刷出）</div>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {consumables.map((c) => {
            const cfg = CONSUMABLE_CFG[c.kind];
            const tgt = useTarget[c.id] ?? run.team[0]?.uid ?? '';
            return (
              <div
                key={c.id}
                className="card"
                style={{ borderColor: cfg.color, minWidth: 200 }}
              >
                <div style={{ color: cfg.color, fontWeight: 700 }}>{cfg.icon} {cfg.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{cfg.desc}</div>
                <div className="row" style={{ gap: 4, marginTop: 4, alignItems: 'center' }}>
                  <select
                    value={tgt}
                    onChange={(e) => setUseTarget((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    style={{ flex: 1, fontSize: 11 }}
                  >
                    {run.team.map((h) => (
                      <option key={h.uid} value={h.uid}>
                        {displayName(h)}{h.star && h.star > 1 ? ` ${h.star}★` : ''}
                      </option>
                    ))}
                  </select>
                  <button className="primary" style={{ padding: '2px 8px', fontSize: 11 }}
                    disabled={!tgt} onClick={() => useConsumable(c.id, tgt)}>
                    使用
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sellConfirm && (
        <ConfirmDialog
          title={`确认出售「${displayName(sellConfirm)}」？`}
          body={
            <>
              该副本将<b style={{ color: '#ff8a8a' }}>永久离队</b>，其星级
              （{sellConfirm.star ?? 1}★）、突破加成
              {sellConfirm.mount ? '、已解锁的坐骑' : ''}
              与累计成长<b style={{ color: '#ff8a8a' }}>一并消失，无法找回</b>。
              <br />
              · 返还金币：<b style={{ color: '#ffd24a' }}>{Math.round(recruitCost * 0.8)}</b>
              （招募价 {recruitCost} 的 80%）
              <br />
              · 身上 <b>{(equipped[sellConfirm.uid] ?? []).length}</b> 件装备会卸回背包
            </>
          }
          confirmLabel="确认出售"
          onConfirm={() => { sellHero(sellConfirm.uid); setSellConfirm(null); }}
          onCancel={() => setSellConfirm(null)}
        />
      )}
    </div>
  );
}
