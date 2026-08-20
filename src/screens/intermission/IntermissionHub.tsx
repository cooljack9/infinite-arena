// 休整屏 · 中枢页（需求 ① + ③）。
// 单屏「喘息」改为：总览（开箱 / 队伍面板·出售 / 药剂 / 招募）+ 三套子页面导航
// （穿戴 / 融合 / 商店）+ 「建议下一步」渐进引导。每套子页各自管理筛选项，见同目录。
import { useCallback, useState } from 'react';
import { useGame } from '../../game/state/store';
import { isRemoteMode, applySnapshot, genIdemKey } from '../../backend/storeBridge';
import { getBackend } from '../../backend/index';
import { deleteSave } from '../../game/saves';
import { HeroDef, Chest } from '@arena/core/types';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { HERO_BY_ID } from '@arena/core/content/heroes';
import { recruitCostOf } from '@arena/core/rules/economy';
import { displayName } from '@arena/core/engine/unit';
import { CONSUMABLE_CFG } from '@arena/core/content/consumables';
import type { ClimbOptsDTO } from '@arena/core/contract';
import { CORE_VERSION } from '@arena/core/contract';
import type { ClimbStrategy } from '@arena/core/content/climb';
import { toast } from '../../components/Toast';
import HeroPanel from '../HeroPanel';
import ConfirmDialog from '../ConfirmDialog';
import TutorialOverlay from '../TutorialOverlay';
import EquipTab from './EquipTab';
import ForgeTab from './ForgeTab';
import ShopTab from './ShopTab';
import ClimbConfig from './ClimbConfig';
import HelpButton from '../../components/HelpButton';
import MechanismHelp from '../../components/MechanismHelp';
import { runAutoClimb } from '../../game/autoclimb';

type Tab = 'equip' | 'forge' | 'shop';

// v1.8.3 卡死修复：未开启箱子列表无上限（打很多关不开箱会无限积累），
// 进入面板全量渲染会让安卓 WebView 主线程爆掉。最多渲染此数，其余引导「全部开启」一次清空。
const MAX_CHESTS_SHOWN = 40;

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
  const setFxBusyWaves = useGame((s) => s.setFxBusyWaves);
  const recruitPool = useGame((s) => s.recruitPool);
  const recruit = useGame((s) => s.recruit);
  const sellHero = useGame((s) => s.sellHero);
  const useConsumable = useGame((s) => s.useConsumable);
  const recruitCost = useGame((s) => s.recruitCost)();
  const refreshRecruit = useGame((s) => s.refreshRecruit);
  const setLayer = useGame((s) => s.setLayer);
  const setScreen = useGame((s) => s.setScreen);
  const setBattleCtx = useGame((s) => s.setBattleCtx);
  const setClimbSession = useGame((s) => s.setClimbSession);
  const lastBreakthrough = useGame((s) => s.lastBreakthrough);
  const reset = useGame((s) => s.reset);
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

  const setPrefetchBattle = useGame((s) => s.setPrefetchBattle);
  // v1.8.1 进战预热：云端模式为用户即将进入的下一层后台 startBattle，先把权威回放算好，
  // 进入 BattleScreen 时若匹配则直接采用，消除「正在进入战场」黑屏。
  const prefetchNext = useCallback(async (mode: 'normal' | 'skip5') => {
    if (!isRemoteMode()) return;
    const runId = run.runId;
    if (!runId) return;
    const key = genIdemKey();
    try {
      const r = await getBackend().startBattle({
        runId,
        idempotencyKey: key,
        coreVersion: CORE_VERSION,
        formation: useGame.getState().formation,
        clientTs: Date.now(),
      });
      if (r.ok) setPrefetchBattle({ data: r.data, runLayer: run.layer, mode, key });
    } catch (e) {
      console.warn('[arena] 进战预热失败（不影响主流程）:', e);
    }
  }, [run.runId, run.layer, setPrefetchBattle]);

  const next = () => {
    // 本地模式：手动推进一层；云端模式：layer 已在 startBattle 权威结算时推进，这里只切屏
    if (!isRemoteMode()) setLayer(run.layer + 1);
    setScreen('pre');
    // v1.8.1 云端预热下一层（用户在 PreBattle 停留期间后台算好回放）
    if (isRemoteMode()) void prefetchNext('normal');
  };

  // v1.8 层数三选一：下五层 / 自动爬塔
  const [climbCfgOpen, setClimbCfgOpen] = useState(false);
  const [climbRunning, setClimbRunning] = useState(false);
  // 放弃挑战：显式落终态（云端 run.status='lost'），避免玩家退出后 run 永久停留 active
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  // v2.10：可选区（药剂/招募）默认折叠；桌面默认展开、移动端默认收起
  const [optionalOpen, setOptionalOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 560 : true,
  );
  // v2.10：当前打开的「?」说明
  const [help, setHelp] = useState<{ anchorId: string; title: string; text: string } | null>(null);
  const onAbandon = async () => {
    setAbandonConfirm(false);
    if (isRemoteMode() && run.runId) {
      try {
        await getBackend().abandonRun({ runId: run.runId, idempotencyKey: genIdemKey(), coreVersion: CORE_VERSION });
      } catch (e) {
        console.warn('[arena] abandonRun 失败（仍返回主菜单）:', e);
      }
    }
    // v1.8.3 三存档：本地模式放弃挑战 = 清掉当前槽位（终局作废，不再可继续）
    if (!isRemoteMode()) {
      const slot = useGame.getState().activeSlot;
      if (slot !== null) { deleteSave(slot); useGame.getState().setActiveSlot(null); }
    }
    reset(); // 结束本局，回主菜单并清空本局状态
  };
  const startSkip5 = () => {
    setBattleCtx({ mode: 'skip5' });
    setScreen('pre');
    // v1.8.1 云端预热下五层回放
    if (isRemoteMode()) void prefetchNext('skip5');
  };
  const openClimb = () => {
    if ((run.failures ?? 0) >= 2) return; // 剩余容错为 0 不可进（「生命值大于 1」= 现有容错）
    setClimbCfgOpen(true);
  };
  // c1/c2 确认后：飘字 3 秒（期间后台演算）→ 本地模式一律逐层播放完整动画
  // （成功/失败/胜率/封顶都播；上浮「本层后停止」可随时收手，保留已获奖励）；
  // 远程模式无逐场回放，一次性传送结果。
  const startClimb = async (strategy: ClimbStrategy, winRateTarget: number) => {
    setClimbCfgOpen(false);
    setClimbRunning(true);
    setFxBusyWaves('挑战即将开始', '准备迎接梦魇吧！全军突击！');
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 300)); // 先渲染飘字遮罩，再演算
    const opts: ClimbOptsDTO = { strategy, winRateTarget: winRateTarget / 100 };
    const resp = await runAutoClimb(opts);
    const elapsed = Date.now() - t0;
    if (elapsed < 3000) await new Promise((r) => setTimeout(r, 3000 - elapsed)); // 飘字满 3 秒
    setFxBusy(null);
    setClimbRunning(false);
    if ('code' in resp) { toast(`自动爬塔失败：${resp.message}`, 'warn'); return; }
    const result = resp.result;
    if (!isRemoteMode() && result.layers.length > 0) {
      // 逐层播放完整动画（从第一场开始，层间自动续战）
      setLayer(result.layers[0].layer);
      setBattleCtx({ mode: 'climb', strategy, winRateTarget: winRateTarget / 100 });
      setClimbSession({ result, idx: 0, stopRequested: false });
      setScreen('battle');
      return;
    }
    // 远程 / 一关未打（胜率未达目标）：一次性传送结果
    if (isRemoteMode()) applySnapshot(useGame.setState, resp.snapshot);
    const cleared = result.layers.filter((l) => l.win).length;
    if (cleared === 0 && result.stopReason === 'winrate') {
      toast('自动爬塔未开始：预计胜率未达目标，先提升队伍再试', 'warn');
      return;
    }
    const stopNote = result.stopReason === 'winrate' ? '（预计胜率跌破目标）' : result.stopReason === 'cap' ? '（已到封顶）' : '';
    toast(`自动爬塔完成：连清 ${cleared} 层 · 获得 ${result.totalGold} 金币 ${stopNote}`, 'ok');
  };
  const openAll = () => {
    const ids = pendingDrops.map((d) => d.id);
    if (ids.length === 0) return;
    const mark: Record<string, boolean> = {};
    for (const id of ids) mark[id] = true;
    setOpening(mark);            // 全部宝箱同时亮动画（满足感拉满）
    setFxBusyWaves('正在开启宝箱…', '已完成开启宝箱');  // 悬浮提示 + 锁全局交互（防连点）
    openDrops(ids);              // 一次批量开（云端单次写，全部成交）
    setTimeout(() => { setOpening({}); setFxBusy(null); toast(`已开启 ${ids.length} 个宝箱`, 'ok'); }, 1250); // 响应上限 1.25s
  };
  // 单开：3s 开启动画，期间已发请求
  const openChest = (id: string) => {
    if (opening[id]) return;
    setOpening({ [id]: true });
    setFxBusyWaves('正在开启宝箱…', '已完成开启宝箱');
    openDrop(id);
    setTimeout(() => { setOpening({}); setFxBusy(null); toast('已开启宝箱', 'ok'); }, 1250);
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

  const tabBtn = (key: Tab, label: string) => {
    const reco = steps[0]?.tab === key;
    const ids: Record<Tab, string> = { equip: 'tut-equip', forge: 'tut-forge', shop: 'tut-shop' };
    return (
      <button
        id={ids[key]}
        key={key}
        role="tab"
        aria-selected={tab === key}
        className={'seg-btn' + (tab === key ? ' active' : '') + (reco ? ' recommended' : '')}
        onClick={() => setTab(key)}
      >
        {label}{reco ? ' ✦' : ''}
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
            <div
              className="tag"
              style={{
                marginTop: 6, color: '#7ee08a', borderColor: '#7ee08a55',
                whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.6, maxWidth: '100%',
              }}
            >
              ✨ 属性突破：{bh ? displayName(bh) : '勇者'} 的
              {{ con: '强壮', str: '力量', agi: '敏捷', int: '智力' }[lastBreakthrough.key]} +{lastBreakthrough.add}%
            </div>
          );
        })(        )}

        {killGainsText && (
          <div
            className="tag"
            style={{
              marginTop: 6, color: '#7ee08a', borderColor: '#7ee08a55',
              // v1.8.4 修复：成长信息条长文本不再溢出网页（覆盖 .tag 的 nowrap）
              whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.6,
              maxWidth: '100%', textAlign: 'left',
            }}
          >
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

        {/* ── 三套子页面导航（v1.3：.seg + role=tablist，键盘可达）── */}
        <div className="seg" role="tablist" aria-label="休整子页面" style={{ marginTop: 10 }}>
          {tabBtn('equip', '🎽 穿戴')}
          {tabBtn('forge', '🔥 融合')}
          {tabBtn('shop', '🛒 商店')}
        </div>

        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          {tab === 'equip' && <EquipTab />}
          {tab === 'forge' && <ForgeTab />}
          {tab === 'shop' && <ShopTab />}
        </div>

        {/* ── 可选区：一次性药剂 + 英雄招募（默认折叠，UX-4 减负）── */}
        <details className="collapsible" open={optionalOpen} onToggle={(e) => setOptionalOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>可选 · 药剂 / 招募（按需展开）</summary>
          <div style={{ marginTop: 8 }}>
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
              setFxBusyWaves('正在招募新的志愿者，请稍等', '已完成招募刷新');   // 悬浮提示 + 锁全局交互
              refreshRecruit();                          // 立即发请求（云端后台 / 本地即时）
              setTimeout(() => { setRecruitRefreshing(false); setFxBusy(null); }, 1250); // 响应上限 1.25s
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
                        setFxBusyWaves('恭喜主公新获一员大将', `${h.name}誓死追随主公！`);   // 两段波：首句不变 + 角色宣誓
                        recruit(h.id);
                        setTimeout(() => { setRecruiting(false); setFxBusy(null); }, 1250);
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
          </div>
        </details>

        {/* v1.8 前往第几层：常驻底部行动栏（UX-4 减负 + UX-9 统一），下五层/爬塔附「?」说明 */}
        <div className="action-bar">
          <button
            id="tut-next-layer"
            className="primary climb-opt"
            style={{ background: 'linear-gradient(135deg,#1f5d3d,#2e7d4f)', borderColor: '#3fae68', color: '#d8ffe8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            onClick={next}
          >
            <span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>🟢 下一层</span>
              <span className="tag" style={{ color: '#a8e8c4' }}>难度正常 · 前往第 {run.layer + 1} 层</span>
            </span>
          </button>
          <button
            id="tut-skip5"
            className="primary climb-opt"
            style={{ background: 'linear-gradient(135deg,#6b5317,#8a6d1f)', borderColor: '#c9a33f', color: '#ffe9b0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            onClick={startSkip5}
          >
            <span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>🟡 下五层</span>
              <span className="tag" style={{ color: '#eed9a0' }}>敌强 = 五层后 ×1.20 · 高奖 +10% · 奖励 = 五层之和</span>
            </span>
            <HelpButton label="下五层说明" onClick={() => setHelp({ anchorId: 'tut-skip5', title: '下五层（跳关）', text: '一次性连打 5 层：敌人更强（5 层后 ×1.20），但奖励是五层之和再多 +10%，适合阵容成型后冲进度。' })} />
          </button>
          <button
            id="tut-climb"
            className="primary climb-opt"
            style={{ background: 'linear-gradient(135deg,#5d1f1f,#7d2e2e)', borderColor: '#c93f3f', color: '#ffd2d2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: (run.failures ?? 0) >= 2 ? 0.45 : 1 }}
            onClick={openClimb}
            disabled={(run.failures ?? 0) >= 2}
            title={(run.failures ?? 0) >= 2 ? '剩余容错为 0，无法自动爬塔' : ''}
          >
            <span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>🔴 自动爬塔</span>
              <span className="tag" style={{ color: '#f0c4c4' }}>
                {(run.failures ?? 0) >= 2 ? '剩余容错为 0，无法自动爬塔' : '连续挑战 ≤10 层 · 每层难度 +10%~15% · 收益不变'}
              </span>
            </span>
            <HelpButton label="自动爬塔说明" onClick={() => setHelp({ anchorId: 'tut-climb', title: '自动爬塔', text: '挂着连打 ≤10 层：每层难度 +10%~15%、收益不变，可选战略（稳健/安全/激进/贪婪）与「预计胜率目标」自动收手。剩余容错为 0 时不可进入。' })} />
          </button>
          <button
            className="ghost climb-opt"
            style={{ borderColor: '#5a6478', color: '#aab2c4', justifyContent: 'center' }}
            onClick={() => setAbandonConfirm(true)}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>🚪 放弃挑战</span>
            <span className="tag" style={{ color: '#9aa3b5' }}>结束本局并返回主菜单</span>
          </button>
        </div>
      </div>

      {climbCfgOpen && !climbRunning && (
        <ClimbConfig
          onClose={() => setClimbCfgOpen(false)}
          onConfirm={(strategy, winRate) => void startClimb(strategy, winRate)}
        />
      )}

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

      {abandonConfirm && (
        <ConfirmDialog
          title="确认放弃本次挑战？"
          body={
            <>
              本局将标记为<b style={{ color: '#ff8a8a' }}>已结束</b>并返回主菜单，
              已获得的层数 / 金币 / 装备<b style={{ color: '#ff8a8a' }}>一并结算作废</b>，无法继续。
              <br />
              · 云端进度会立即落库（run 终态），不会再停留在「进行中」。
            </>
          }
          confirmLabel="放弃挑战"
          onConfirm={onAbandon}
          onCancel={() => setAbandonConfirm(false)}
        />
      )}

      <TutorialOverlay
        screen="inter"
        onStep={(anchorId) => {
          const t = ANCHOR_TAB[anchorId];
          if (t) setTab(t);
        }}
      />

      {/* v2.10 高阶机制「?」说明（全模式可用，UX-5） */}
      {help && (
        <MechanismHelp
          anchorId={help.anchorId}
          title={help.title}
          text={help.text}
          onClose={() => setHelp(null)}
        />
      )}
    </div>
  );
}
