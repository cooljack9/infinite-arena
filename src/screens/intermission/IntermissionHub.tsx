// 休整屏 · 中枢页（需求 ① + ③）。
// 单屏「喘息」改为：总览（开箱 / 队伍面板·出售 / 药剂 / 招募）+ 三套子页面导航
// （穿戴 / 融合 / 商店）+ 「建议下一步」渐进引导。每套子页各自管理筛选项，见同目录。
import { useState } from 'react';
import { useGame } from '../../game/state/store';
import { isRemoteMode } from '../../backend/storeBridge';
import { HeroDef, Chest } from '@arena/core/types';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { displayName } from '@arena/core/engine/unit';
import { CONSUMABLE_CFG } from '@arena/core/content/consumables';
import HeroPanel from '../HeroPanel';
import ConfirmDialog from '../ConfirmDialog';
import TutorialOverlay from '../TutorialOverlay';
import EquipTab from './EquipTab';
import ForgeTab from './ForgeTab';
import ShopTab from './ShopTab';

type Tab = 'equip' | 'forge' | 'shop';

/**
 * 教学锚点 → 所属子页。三子页是条件渲染的，锚点只在对应页激活时存在，
 * 所以教学浮层每推进一步都会把 anchorId 回调过来，由这里自动切页（教学同步改动，需求 ①）。
 * 不在表里的锚点（tut-hero-panel / tut-hero-sell 等）常驻中枢页，无需切页。
 */
const ANCHOR_TAB: Record<string, Tab> = {
  'tut-equip': 'equip',
  'tut-inventory': 'equip',
  'tut-inventory-grid': 'equip',
  'tut-forge': 'forge',
  'tut-forge-transfer': 'forge',
  'tut-forge-reroll': 'forge',
  'tut-fuse': 'forge',
  'tut-shop': 'shop',
  'tut-shop-buy': 'shop',
  'tut-shop-buy-grid': 'shop',
  'tut-shop-refresh': 'shop',
};

const CHEST_VIEW: Record<string, { icon: string; label: string; color: string }> = {
  equip_normal: { icon: '📦', label: '普通装备', color: '#cfcfcf' },
  gold_small:   { icon: '💰', label: '少量金币', color: '#ffd24a' },
  equip_high:   { icon: '🔵', label: '高级装备', color: '#4aa3ff' },
  equip_rare:   { icon: '🟣', label: '稀有装备', color: '#ff4d6d' },
  gold_large:   { icon: '💎', label: '大量金币', color: '#7ee08a' },
};

export default function IntermissionHub() {
  const run = useGame((s) => s.run)!;
  const gold = useGame((s) => s.gold);
  const inventory = useGame((s) => s.inventory);
  const pendingDrops = useGame((s) => s.pendingDrops);
  const equipped = useGame((s) => s.equipped);
  const tradeCount = useGame((s) => s.tradeCount);
  const fusedThisLayer = useGame((s) => s.fusedThisLayer);
  const shopStock = useGame((s) => s.shopStock);
  const consumables = useGame((s) => s.consumables);
  const discount = useGame((s) => s.discount)();
  const openDrop = useGame((s) => s.openDrop);
  const openDrops = useGame((s) => s.openDrops);
  const setFxBusy = useGame((s) => s.setFxBusy);
  const recruitPool = useGame((s) => s.recruitPool);
  const recruit = useGame((s) => s.recruit);
  const sellHero = useGame((s) => s.sellHero);
  const useConsumable = useGame((s) => s.useConsumable);
  const recruitCost = useGame((s) => s.recruitCost)();
  const refreshRecruit = useGame((s) => s.refreshRecruit);
  const setLayer = useGame((s) => s.setLayer);
  const setScreen = useGame((s) => s.setScreen);
  const lastBreakthrough = useGame((s) => s.lastBreakthrough);
  const lastKillGains = useGame((s) => s.lastKillGains);

  const [tab, setTab] = useState<Tab>('equip');
  const [heroIdx, setHeroIdx] = useState(0);
  // v3.2c 招募刷新动画（3s 悬浮提示 + 锁全局交互，防连点刷新）
  const [recruitRefreshing, setRecruitRefreshing] = useState(false);
  // v3.3b 招募动画：恭喜主公新获一员大将（3s 悬浮提示）
  const [recruiting, setRecruiting] = useState(false);
  const [panel, setPanel] = useState<{ hero: HeroDef; preview?: any[] } | null>(null);
  const [sellConfirm, setSellConfirm] = useState<HeroDef | null>(null);
  const [useTarget, setUseTarget] = useState<Record<string, string>>({});
  // v3.2 开箱动画：正在开的箱子 id -> true（3s 动画掩盖后端延迟，结束后展示结果）
  const [opening, setOpening] = useState<Record<string, boolean>>({});

  const heroLevel = 1 + Math.floor((run.layer - 1) / 2);

  const next = () => {
    // 本地模式：手动推进一层；云端模式：layer 已在 startBattle 权威结算时推进，这里只切屏
    if (!isRemoteMode()) setLayer(run.layer + 1);
    setScreen('pre');
  };
  const openAll = () => {
    const ids = pendingDrops.map((d) => d.id);
    if (ids.length === 0) return;
    const mark: Record<string, boolean> = {};
    for (const id of ids) mark[id] = true;
    setOpening(mark);            // 全部宝箱同时亮动画（满足感拉满）
    setFxBusy('正在开启宝箱…');  // 悬浮提示 + 锁全局交互（防连点）
    openDrops(ids);              // 一次批量开（云端单次写，全部成交）
    setTimeout(() => { setOpening({}); setFxBusy(null); }, 3000); // 3s 动画结束，展示结果
  };
  // 单开：3s 开启动画，期间已发请求
  const openChest = (id: string) => {
    if (opening[id]) return;
    setOpening({ [id]: true });
    setFxBusy('正在开启宝箱…');
    openDrop(id);
    setTimeout(() => { setOpening({}); setFxBusy(null); }, 3000);
  };

  const freeSlots = run.team.reduce((s, h) => s + Math.max(0, 6 - (equipped[h.uid] ?? []).length), 0);
  const shopCount = shopStock.equipment.length + shopStock.consumables.length;
  const cheapest = Math.min(
    ...[...shopStock.equipment, ...shopStock.consumables].map((s) => Math.round(s.basePrice * (1 - discount))),
    Infinity,
  );
  const fusable = inventory.filter((e) => e.rarity !== 'normal').length >= 2;

  // ── 「建议下一步」渐进引导（需求 ③）──
  const steps: { tab: Tab; icon: string; label: string }[] = [];
  if (freeSlots > 0 && inventory.length > 0) steps.push({ tab: 'equip', icon: '🎽', label: '一键装备' });
  if (shopCount > 0 && gold >= cheapest) steps.push({ tab: 'shop', icon: '🛒', label: '一键全买' });
  if (fusable) steps.push({ tab: 'forge', icon: '🔥', label: '可合成' });

  const viewBtn = (h: HeroDef, preview?: any[]) => (
    <button
      style={{ padding: '2px 8px', fontSize: 11 }}
      onClick={(ev) => { ev.stopPropagation(); setPanel({ hero: h, preview }); }}
    >
      📊 面板
    </button>
  );

  // ── 战后属性成长展示（v1.7 §2；击杀者 100%~150%、助攻者 30%~50%）──
  const PK_CN: Record<string, string> = { con: '强壮', str: '力量', agi: '敏捷', int: '智力' };
  const SK_CN: Record<string, string> = { hp: '生命', pDmg: '物伤', mDmg: '法伤', heal: '治疗' };
  const fmtV = (v: number) => (Math.round(v * 10) / 10).toString();
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

  const tabBtn = (id: string, key: Tab, label: string) => {
    const recommended = steps[0]?.tab === key;
    return (
      <button
        id={id}
        key={key}
        className={tab === key ? 'primary' : ''}
        style={{
          padding: '6px 14px', fontSize: 13, flex: 1,
          outline: recommended ? '2px solid #7ee08a' : 'none',
        }}
        onClick={() => setTab(key)}
      >
        {label}{recommended ? ' ✦' : ''}
      </button>
    );
  };

  return (
    <div className="app">
      <div className="panel col" style={{ maxWidth: 760, width: '100%' }}>
        <div className="title" style={{ fontSize: 18 }}>第 {run.layer} 层 · 已通关</div>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className="tag">金币 <b style={{ color: '#ffd24a' }}>{gold}</b></span>
          <span className="tag">交易 {tradeCount} 次 · 折扣 {(discount * 100).toFixed(0)}% off</span>
          <span className="tag">背包 {inventory.length} · 掉落箱 {pendingDrops.length}</span>
          <span className="tag">本层合成 {fusedThisLayer}/2</span>
        </div>

        {lastBreakthrough && (() => {
          const bh = run.team.find((h) => h.uid === lastBreakthrough.heroUid)
            ?? run.team.find((h) => h.id === lastBreakthrough.heroId);
          return (
            <div className="tag" style={{ marginTop: 6, color: '#7ee08a', borderColor: '#7ee08a55' }}>
              ✨ 属性突破：{bh ? displayName(bh) : '勇者'} 的
              {{ con: '强壮', str: '力量', agi: '敏捷', int: '智力' }[lastBreakthrough.key]} +{lastBreakthrough.add}%
            </div>
          );
        })(        )}

        {killGainsText && (
          <div className="tag" style={{ marginTop: 6, color: '#7ee08a', borderColor: '#7ee08a55' }}>
            ⚔ 战后成长：{killGainsText}
          </div>
        )}

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
              {pendingDrops.map((d: Chest) => {
                const v = CHEST_VIEW[d.reward];
                const isOpening = !!opening[d.id];
                return (
                  <div
                    key={d.id}
                    onClick={() => openChest(d.id)}
                    style={{
                      cursor: 'pointer', border: `1px dashed ${v.color}`, borderRadius: 8,
                      padding: '10px 14px', color: '#bbb', textAlign: 'center',
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
          </>
        )}

        {/* ── 队伍：面板 / 出售（教学锚点）── */}
        <div className="subtitle" style={{ marginTop: 12, textAlign: 'left' }}>队伍 · 面板 / 出售</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {run.team.map((h, i) => (
            <span key={h.uid} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <button
                className={i === heroIdx ? 'primary' : ''}
                style={{ padding: '2px 10px' }}
                onClick={() => setHeroIdx(i)}
              >
                {displayName(h)}
                {(h.star ?? 1) > 1 && <span style={{ color: '#ffd24a' }}> {(h.star ?? 1)}★</span>}
                {h.pendingBurst && <span style={{ color: '#ff9a3c' }} title="爆发药剂生效中">⚡</span>}
                （{(equipped[h.uid] ?? []).length}/6）
              </button>
              <span id="tut-hero-panel">{viewBtn(h)}</span>
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

        {/* ── 建议下一步（渐进引导）── */}
        <div id="tut-guide" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px dashed #7ee08a55', background: 'rgba(126,224,138,0.06)' }}>
          <div className="subtitle" style={{ marginTop: 0, textAlign: 'left', color: '#9fe8b4' }}>
            💡 建议下一步（按推荐顺序）
          </div>
          {steps.length === 0 ? (
            <div className="muted">装备已穿满、商店无货、无可合成件——直接前往下一层挑战吧。</div>
          ) : (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {steps.map((s, i) => (
                <button
                  key={s.tab + i}
                  style={{
                    padding: '4px 10px', fontSize: 12,
                    border: '1px solid #7ee08a', color: '#bff3c8', background: 'rgba(126,224,138,0.10)',
                  }}
                  onClick={() => setTab(s.tab)}
                >
                  {i + 1}. {s.icon} {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 三套子页面导航 ── */}
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {tabBtn('tut-equip', 'equip', '🎽 穿戴')}
          {tabBtn('tut-forge', 'forge', '🔥 融合')}
          {tabBtn('tut-shop', 'shop', '🛒 商店')}
        </div>

        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          {tab === 'equip' && <EquipTab />}
          {tab === 'forge' && <ForgeTab />}
          {tab === 'shop' && <ShopTab />}
        </div>

        {/* ── 一次性药剂 ── */}
        <div className="subtitle" style={{ marginTop: 12, textAlign: 'left' }}>一次性药剂（已购买）</div>
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
                  style={{
                    border: `1px solid ${cfg.color}`, borderRadius: 8, padding: '6px 8px', minWidth: 200,
                    background: 'rgba(0,0,0,0.2)', color: '#e8e8e8', fontSize: 12,
                  }}
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
              setFxBusy('正在招募新的志愿者，请稍等');   // 悬浮提示 + 锁全局交互
              refreshRecruit();                          // 立即发请求（云端后台 / 本地即时）
              setTimeout(() => { setRecruitRefreshing(false); setFxBusy(null); }, 3000); // 3s 动画
            }}
            title="花 1 金币重新随机招募池"
          >
            {recruitRefreshing ? '🔄 招募中…' : '🔄 刷新 (1💰)'}
          </button>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          购买英雄 = 再招募一份副本（可上场多个同名角色）；升星 / 突破请在该角色的「面板」中点「升星」。不需要的副本可点其「✕」出售。
        </div>
        {recruitPool.length === 0 ? (
          <div className="muted" style={{ marginTop: 4 }}>本层暂无可招募勇者</div>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {recruitPool.map((h) => {
              const info = SUBCLASS_INFO[h.subclass];
              const owned = run.team.some((t) => t.id === h.id);
              const full = run.team.length >= 7;
              const can = gold >= recruitCost && !full;
              const label = full ? '队伍已满' : owned ? `招募副本 ${recruitCost}` : `招募 ${recruitCost}`;
              const panelHero = owned ? run.team.find((t) => t.id === h.id) ?? h : h;
              return (
                <div
                  key={h.id}
                  style={{
                    border: `1px solid ${info.color}`, borderRadius: 8, padding: '6px 8px',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 10px ${info.color}22`,
                    minWidth: 168, color: '#e8e8e8', fontSize: 12,
                  }}
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
                        setFxBusy('恭喜主公新获一员大将');   // 悬浮提示 3s（请求已发出，快照落地）
                        recruit(h.id);
                        setTimeout(() => { setRecruiting(false); setFxBusy(null); }, 3000);
                      }}
                    >
                      {recruiting ? '✨ 招募中…' : label}
                    </button>
                    {viewBtn(panelHero)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button className="primary" style={{ marginTop: 14, alignSelf: 'flex-end' }} onClick={next}>
          前往第 {run.layer + 1} 层 →
        </button>
      </div>

      {panel && (
        <HeroPanel
          hero={panel.hero}
          level={heroLevel}
          equipment={equipped[panel.hero.uid] ?? []}
          preview={panel.preview}
          onClose={() => setPanel(null)}
        />
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

      <TutorialOverlay
        screen="inter"
        onStep={(anchorId) => {
          const t = ANCHOR_TAB[anchorId];
          if (t) setTab(t);
        }}
      />
    </div>
  );
}
