// 休整屏 · 中枢页（v2.4.7 整备界面拆分重构）。
// 旧版把 11 组信息竖向堆叠在一屏（用户反馈「看一眼就爆炸」），现改为：
// 常驻头部（状态）+ 4 个聚焦页（战报/队伍/补给/装备）+ 常驻底部行动栏。
// 各页实现在 ./pages/；EquipTab / ForgeTab / ShopTab 原样复用；tut-* 教学锚点全数保留。
import { useCallback, useState } from 'react';
import { useGame } from '../../game/state/store';
import { isRemoteMode, applySnapshot, genIdemKey } from '../../backend/storeBridge';
import { getBackend } from '../../backend/index';
import { deleteSave } from '../../game/saves';
import { HeroDef } from '@arena/core/types';
import type { ClimbOptsDTO } from '@arena/core/contract';
import { CORE_VERSION } from '@arena/core/contract';
import type { ClimbStrategy } from '@arena/core/content/climb';
import { toast } from '../../components/Toast';
import HeroPanel from '../HeroPanel';
import ConfirmDialog from '../ConfirmDialog';
import TutorialOverlay from '../TutorialOverlay';
import ClimbConfig from './ClimbConfig';
import HelpButton from '../../components/HelpButton';
import MechanismHelp from '../../components/MechanismHelp';
import { runAutoClimb } from '../../game/autoclimb';
import ReportPage from './pages/ReportPage';
import TeamPage from './pages/TeamPage';
import SupplyPage from './pages/SupplyPage';
import GearPage from './pages/GearPage';
import type { PageKey, GearSub, GuideTarget } from './pages/types';

/**
 * 教学锚点 → 所属页面（+ 装备子页签）。锚点只在对应页激活时存在，
 * 所以教学浮层每推进一步都会把 anchorId 回调过来，由这里自动切页。
 * 不在表里的锚点（tut-hero-panel / tut-hero-sell / tut-guide / tut-next-layer 等）常驻或默认页可见。
 */
const ANCHOR_PAGE: Record<string, GuideTarget> = {
  'tut-equip': { page: 'gear', sub: 'equip' },
  'tut-inventory': { page: 'gear', sub: 'equip' },
  'tut-inventory-grid': { page: 'gear', sub: 'equip' },
  'tut-forge': { page: 'gear', sub: 'forge' },
  'tut-forge-transfer': { page: 'gear', sub: 'forge' },
  'tut-forge-reroll': { page: 'gear', sub: 'forge' },
  'tut-fuse': { page: 'gear', sub: 'forge' },
  'tut-shop': { page: 'supply' },
  'tut-shop-buy': { page: 'supply' },
  'tut-shop-buy-grid': { page: 'supply' },
  'tut-shop-refresh': { page: 'supply' },
  // v2.5.1：升星 / 卖出 教学点指向队伍页（TeamPage 内的英雄面板），此前未入表
  // → 锚点在默认战报页不可见，教学云退化成居中无箭头、指向的模块对不上。
  'tut-hero-panel': { page: 'team' },
  'tut-hero-sell': { page: 'team' },
};

export default function IntermissionHub() {
  const run = useGame((s) => s.run)!;
  const gold = useGame((s) => s.gold);
  const inventory = useGame((s) => s.inventory);
  const pendingDrops = useGame((s) => s.pendingDrops);
  const equipped = useGame((s) => s.equipped);
  const tradeCount = useGame((s) => s.tradeCount);
  const fusedThisLayer = useGame((s) => s.fusedThisLayer);
  const discount = useGame((s) => s.discount)();
  const setFxBusy = useGame((s) => s.setFxBusy);
  const setFxBusyWaves = useGame((s) => s.setFxBusyWaves);
  const setLayer = useGame((s) => s.setLayer);
  const setScreen = useGame((s) => s.setScreen);
  const setBattleCtx = useGame((s) => s.setBattleCtx);
  const setClimbSession = useGame((s) => s.setClimbSession);
  const reset = useGame((s) => s.reset);

  // ── 页面导航状态 ──
  const [page, setPage] = useState<PageKey>('report'); // 战后默认落在「战报」页
  const [gearSub, setGearSub] = useState<GearSub>('equip');
  const [panel, setPanel] = useState<{ hero: HeroDef; preview?: any[] } | null>(null);

  const heroLevel = 1 + Math.floor((run.layer - 1) / 2);

  const setPrefetchBattle = useGame((s) => s.setPrefetchBattle);
  // v1.8.1 进战预热：云端模式后台调 startBattle(**preview:true**)，把 Edge 函数预热起来、回放算法跑一遍。
  // ★ preview 不结算、不落库、不推进层数（battleId=null），因此**不会被 BattleScreen 消费**——
  //   这里只是「温机」，避免确认开战时才冷启动 Edge。真正提交点（preview:false、返回 battleId）
  //   在 PreBattle.confirm（玩家布阵定稿那一刻），BattleScreen 消费的是那一份。
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
        preview: true, // 纯预热：只算回放、不结算、不推进层数（避免用陈旧布阵锁层）
      });
      if (r.ok) setPrefetchBattle({ data: r.data, runLayer: run.layer, mode, key, formation: useGame.getState().formation });
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

  // 「建议下一步」跳页：战报页按钮 → 切页（+ 装备子页签）
  const onGuideTo = (t: GuideTarget) => {
    setPage(t.page);
    if (t.page === 'gear') setGearSub(t.sub ?? 'equip');
  };

  const pageBtn = (key: PageKey, label: string, anchorId?: string) => (
    <button
      id={anchorId}
      key={key}
      role="tab"
      aria-selected={page === key}
      className={'seg-btn' + (page === key ? ' active' : '')}
      onClick={() => setPage(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="app">
      <div className="panel col" style={{ maxWidth: 760, width: '100%' }}>
        {/* ── 常驻头部：层数 + 核心资源状态（不随页切换）── */}
        <div className="title" style={{ fontSize: 18 }}>第 {run.layer} 层 · 已通关</div>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className="tag">金币 <b style={{ color: '#ffd24a' }}>{gold}</b></span>
          <span className="tag">交易 {tradeCount} 次 · 折扣 {(discount * 100).toFixed(0)}% off</span>
          <span className="tag">背包 {inventory.length} · 掉落箱 {pendingDrops.length}</span>
          <span className="tag">本层合成 {fusedThisLayer}/2</span>
        </div>

        {/* ── 4 个聚焦页导航（role=tablist，键盘可达；tut-shop 锚点挂在补给页签上）── */}
        <div className="seg" role="tablist" aria-label="休整页面" style={{ marginTop: 10 }}>
          {pageBtn('report', '⚔ 战报')}
          {pageBtn('team', '🛡 队伍')}
          {pageBtn('supply', '🛒 补给', 'tut-shop')}
          {pageBtn('gear', '🎽 装备')}
        </div>

        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          {page === 'report' && <ReportPage onGuideTo={onGuideTo} />}
          {page === 'team' && (
            <TeamPage onOpenPanel={(hero, preview) => setPanel({ hero, preview })} />
          )}
          {page === 'supply' && (
            <SupplyPage onOpenPanel={(hero, preview) => setPanel({ hero, preview })} />
          )}
          {page === 'gear' && <GearPage sub={gearSub} onSubChange={setGearSub} />}
        </div>

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
          const t = ANCHOR_PAGE[anchorId];
          if (t) onGuideTo(t);
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
