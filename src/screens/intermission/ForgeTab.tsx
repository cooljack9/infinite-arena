// 休整屏 ·「融合」子页（需求 ①：装备融合拆为独立子页面 + 装备筛选 + 选择含目标属性）。
// 含两块：锻造工坊（属性转移 / 重铸）与合成台（2蓝→1橙 / 2橙→1红 / 红+红升星）。
// 目标装与素材装、以及可合成件，均可用顶部筛选条按「品质 / 含属性 / 评分」过滤，
// 玩家可据此挑选「含有目标属性」的素材或升阶候选。
import { useState } from 'react';
import { useGame } from '../../game/state/store';
import {
  rarityName, transferRate, fuseKindOf, equipDisplayName,
} from '@arena/core/content/equipment';
import { EqCard } from './EqCard';
import { useEquipFilter } from './FilterBar';
import ConfirmDialog from '../ConfirmDialog';

export default function ForgeTab() {
  const inventory = useGame((s) => s.inventory);
  const forgedThisLayer = useGame((s) => s.forgedThisLayer);
  const fusedThisLayer = useGame((s) => s.fusedThisLayer);
  const lastTransferLogs = useGame((s) => s.lastTransferLogs);
  const transferForge = useGame((s) => s.transferForge);
  const transferForgeAll = useGame((s) => s.transferForgeAll);
  const fuse = useGame((s) => s.fuse);
  // v3.3 重铸：白色 → 随机彩色（蓝/橙/红），每层一次
  const reforgeItem = useGame((s) => s.reforgeItem);
  const reforgedThisLayer = useGame((s) => s.reforgedThisLayer);
  const lastReforge = useGame((s) => s.lastReforge);

  const [forgeMode, setForgeMode] = useState<'reroll' | 'transfer'>('transfer');
  const [forgeTarget, setForgeTarget] = useState<string | null>(null);
  const [forgeConsume, setForgeConsume] = useState<string[]>([]);
  const [meltConfirm, setMeltConfirm] = useState<string | null>(null);

  const [fuseSel, setFuseSel] = useState<string[]>([]);
  // v3.2 融合动画：红光幕 3s（掩盖后端延迟，副属性逐个亮起）
  const [fusing, setFusing] = useState(false);
  // v3.3 重铸动画：遮罩「重铸中…」3s
  const [reforging, setReforging] = useState(false);
  const setFxBusy = useGame((s) => s.setFxBusy);
  const [tip, setTip] = useState('');
  const showTip = (t: string) => { setTip(t); window.setTimeout(() => setTip(''), 2800); };

  const normalItems = inventory.filter((e) => e.rarity === 'normal');
  const targetPool = forgeMode === 'reroll' ? normalItems : inventory;
  const materialPool = forgeMode === 'reroll' ? normalItems : inventory;

  // 两块筛选：目标装 / 素材装（均支持「含目标属性」过滤）。固定两个 hook 调用，顺序稳定。
  const tf = useEquipFilter(targetPool);
  const mf = useEquipFilter(materialPool);
  const fusable = inventory.filter((e) => e.rarity !== 'normal');
  const ff = useEquipFilter(fusable);

  const toggleConsume = (id: string) =>
    setForgeConsume((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // v3.3 重铸只用于 transfer（属性转移）；reroll 改走 doReforge
  const doForge = () => {
    if (!forgeTarget || forgeMode !== 'transfer') return;
    transferForge(forgeTarget, forgeConsume);
    setForgeConsume([]);
    setForgeTarget(null);
  };
  // v3.3 重铸：白色 → 随机彩色（蓝/橙/红），每层一次；遮罩「重铸中…」3s 掩盖后端延迟
  const doReforge = () => {
    if (!forgeTarget || reforgedThisLayer || reforging) return;
    setReforging(true);
    setFxBusy('重铸中…');
    reforgeItem(forgeTarget);
    setForgeTarget(null);
    setTimeout(() => { setReforging(false); setFxBusy(null); }, 3000);
  };

  const toggleFuse = (id: string) =>
    setFuseSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2)));
  const fuseA = inventory.find((e) => e.id === fuseSel[0]);
  const fuseB = inventory.find((e) => e.id === fuseSel[1]);
  const fuseKind = fuseA && fuseB ? fuseKindOf(fuseA, fuseB) : null;
  const fuseLeft = 2 - fusedThisLayer;
  const doFuse = () => {
    if (fuseSel.length !== 2 || fusing) return;
    setFusing(true);                          // 红光幕 3s，期间请求已发出
    setFxBusy('正在融合装备…');               // 悬浮提示 + 锁全局交互
    fuse(fuseSel[0], fuseSel[1]);
    setFuseSel([]);
    setTimeout(() => { setFusing(false); setFxBusy(null); }, 3000);
  };

  return (
    <div className="col" style={{ marginTop: 4 }}>
      {tip && (
        <div className="tag" style={{ color: '#8ec5ff', borderColor: '#8ec5ff55' }}>{tip}</div>
      )}

      {/* ── 锻造工坊（§12 + v1.6 §A.4）── */}
      <div className="subtitle" style={{ marginTop: 0, textAlign: 'left' }}>锻造工坊 · 每件装备每层限 1 次</div>
      <div className="row" style={{ gap: 6 }}>
        <button
          id="tut-forge-transfer"
          className={forgeMode === 'transfer' ? 'primary' : ''}
          style={{ padding: '2px 10px' }}
          onClick={() => { setForgeMode('transfer'); setForgeTarget(null); setForgeConsume([]); }}
        >
          属性转移
        </button>
        <button
          id="tut-forge-reroll"
          className={forgeMode === 'reroll' ? 'primary' : ''}
          style={{ padding: '2px 10px' }}
          onClick={() => { setForgeMode('reroll'); setForgeTarget(null); setForgeConsume([]); }}
        >
          重铸（仅普通）
        </button>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        {forgeMode === 'transfer'
          ? '选一件保留的核心装，再选若干素材装（或「一键熔炼全部」）。素材词条按品质概率转移到核心上：白值同名累加、可叠任意条；百分比同类只留一条并取最大值。素材无论成败一律销毁；已穿戴在勇者身上的装备不会被熔。'
          : '白色装备重铸 → 随机变成彩色（蓝 / 橙 / 红），每层限 1 次。不消耗素材、无失败惩罚。'}
      </div>
      {/* v3.3 重铸结果回执 */}
      {forgeMode === 'reroll' && lastReforge && !reforging && (
        <div className="tag" style={{ marginTop: 6, color: '#ffd76a', borderColor: '#ffd76a88' }}>
          ✨ 重铸成功：{lastReforge.name}（{lastReforge.to === 'blue' ? '蓝' : lastReforge.to === 'orange' ? '橙' : '红'}）
        </div>
      )}

      {tf.filtered.length === 0 ? (
        <div className="muted" style={{ marginTop: 6 }}>无可锻造的装备（或筛选后无匹配）</div>
      ) : (
        <>
          <div className="subtitle" style={{ marginTop: 8, textAlign: 'left' }}>
            {forgeMode === 'reroll' ? `① 选择白色装备（本层 ${reforgedThisLayer ? '已重铸' : '可重铸 1 次'}）` : '① 选择目标装（保留的核心装）'}
          </div>
          {tf.controls}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {tf.filtered.map((e) => {
              const done = forgeMode === 'reroll' ? reforgedThisLayer : forgedThisLayer.includes(e.id);
              return (
                <div
                  key={e.id}
                  onClick={() => { if (!done) { setForgeTarget(e.id); setForgeConsume([]); } }}
                  style={{
                    cursor: done ? 'not-allowed' : 'pointer',
                    opacity: done ? 0.45 : 1,
                    outline: forgeTarget === e.id ? '2px solid #ffd24a' : 'none',
                    borderRadius: 8,
                  }}
                >
                  <EqCard e={e} />
                  <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>
                    {done ? (forgeMode === 'reroll' ? '本层已重铸' : '本层已锻') : forgeTarget === e.id ? '★ 目标' : '选为目标'}
                  </div>
                </div>
              );
            })}
          </div>

          {forgeTarget && forgeMode === 'transfer' && (
            <>
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                {`已选 ${forgeConsume.length} 件素材（销毁）`}
              </div>
              <div className="subtitle" style={{ marginTop: 6, textAlign: 'left' }}>② 选择素材装（含目标属性筛选）</div>
              {mf.controls}
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {mf.filtered
                  .filter((e) => e.id !== forgeTarget)
                  .map((e) => {
                    const on = forgeConsume.includes(e.id);
                    return (
                      <div
                        key={e.id}
                        onClick={() => toggleConsume(e.id)}
                        style={{ cursor: 'pointer', outline: on ? '2px solid #ff6b6b' : 'none', borderRadius: 8 }}
                      >
                        <EqCard e={e} />
                        <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>
                          {on ? '已选' : forgeMode === 'transfer' ? `转移率 ${Math.round(transferRate(e.rarity) * 100)}%` : '喂入'}
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="primary"
                  style={{ padding: '4px 12px' }}
                  disabled={forgeConsume.length === 0}
                  onClick={doForge}
                >
                  ⚒ 转移属性（消耗 {forgeConsume.length} 件）
                </button>
                <button
                  style={{ padding: '4px 12px', color: '#ffd24a' }}
                  disabled={inventory.filter((e) => e.id !== forgeTarget).length === 0}
                  title="把背包内其余全部装备作为素材熔进核心装（素材全部销毁，逐条按概率转移）"
                  onClick={() => setMeltConfirm(forgeTarget)}
                >
                  ⚡ 一键熔炼全部（{inventory.filter((e) => e.id !== forgeTarget).length} 件）
                </button>
              </div>
            </>
          )}

          {forgeTarget && forgeMode === 'reroll' && (
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="primary"
                style={{ padding: '4px 14px' }}
                disabled={reforgedThisLayer || reforging}
                onClick={doReforge}
              >
                {reforging ? '✨ 重铸中…' : '✨ 重铸（本层仅此一次）'}
              </button>
            </div>
          )}
        </>
      )}

      {lastTransferLogs.length > 0 && (
        <div
          style={{
            marginTop: 8, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
            padding: '6px 8px', background: 'rgba(0,0,0,0.25)', fontSize: 11,
          }}
        >
          <div className="subtitle" style={{ marginBottom: 3, textAlign: 'left' }}>上次转移结果</div>
          {lastTransferLogs.map((l, i) => (
            <div key={i} style={{ color: l.ok ? '#7ee08a' : '#8b8f99' }}>
              {l.ok ? '✔' : '✘'} {l.keyName} {l.mode === 'pct' ? `${l.value}%` : `+${l.value}`} · {l.note}
            </div>
          ))}
        </div>
      )}

      {/* ── 合成与升星（v1.6 §A.5）── */}
      <div
        className="subtitle"
        id={ff.filtered.length < 2 ? 'tut-fuse' : undefined}
        style={{ marginTop: 14, textAlign: 'left' }}
      >
        合成台 · 本层剩余 {Math.max(0, fuseLeft)} 次
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        2 蓝 → 1 随机橙　|　2 橙 → 1 随机红　|　红 + 任意红 → 先选中的那件升 1 星（最高 5★，词条整体 ×2.0）
      </div>
      {ff.filtered.length < 2 ? (
        <div className="muted" style={{ marginTop: 4 }}>可合成装备不足 2 件（或筛选后无匹配）</div>
      ) : (
        <>
          {ff.controls}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {ff.filtered.map((e) => {
              const idx = fuseSel.indexOf(e.id);
              return (
                <div
                  key={e.id}
                  onClick={() => toggleFuse(e.id)}
                  style={{ cursor: 'pointer', outline: idx >= 0 ? '2px solid #4aa3ff' : 'none', borderRadius: 8 }}
                >
                  <EqCard e={e} />
                  <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>
                    {idx === 0 ? '① 目标' : idx === 1 ? '② 素材' : '选择'}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              id="tut-fuse"
              className={'primary' + (fusing ? ' anim-redglow' : '')}
              style={{ padding: '4px 12px' }}
              disabled={!fuseKind || fuseLeft <= 0 || fusing}
              onClick={doFuse}
            >
              {fusing ? '🔥 融合中…' : `🔥 ${fuseKind === 'ascend' ? '融合升星' : fuseKind === 'upgrade' ? '合成升阶' : '合成'}`}
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              {fuseSel.length < 2
                ? '请选择两件装备'
                : !fuseKind
                  ? '这两件不能合成（需同品质；红装目标须未满 5★）'
                  : fuseKind === 'ascend'
                    ? `将把 ${equipDisplayName(fuseA!)} 升到 ${Math.min(5, (fuseA!.star ?? 1) + 1)}★，另一件销毁`
                    : `将销毁两件${rarityName(fuseA!.rarity)}装，产出 1 件随机${fuseA!.rarity === 'blue' ? '橙' : '红'}装`}
            </span>
          </div>
        </>
      )}

      {meltConfirm && (
        <ConfirmDialog
          title="确认一键熔炼？"
          body={
            <>
              将把背包内其余 <b style={{ color: '#ff8a8a' }}>{inventory.filter((e) => e.id !== meltConfirm).length}</b> 件装备
              全部作为素材熔入
              <b style={{ color: '#ffd24a' }}> {inventory.find((e) => e.id === meltConfirm)?.name ?? '核心装'}</b>。
              <br />
              · 每条词条按素材品质独立判定，成功率 <b>35% / 45% / 55% / 65%</b>（白 / 蓝 / 橙 / 红），<b style={{ color: '#ff8a8a' }}>不是 100%</b>
              <br />
              · 素材<b style={{ color: '#ff8a8a' }}>无论成败一律销毁</b>；已穿戴在勇者身上的装备不受影响
              <br />
              · 本层该核心装的锻造次数将被用掉（每件每层限 1 次）
            </>
          }
          confirmLabel="熔炼"
          onConfirm={() => {
            const n = inventory.filter((e) => e.id !== meltConfirm).length;
            transferForgeAll(meltConfirm);
            setMeltConfirm(null);
            setForgeTarget(null);
            setForgeConsume([]);
            showTip(`⚡ 一键熔炼：投入 ${n} 件素材，结果见上方「上次转移结果」`);
          }}
          onCancel={() => setMeltConfirm(null)}
        />
      )}
    </div>
  );
}
