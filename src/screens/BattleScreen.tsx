import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame, SPEED_OPTIONS } from '../game/state/store';
import { genLayer } from '@arena/core/gen/levelGen';
import { BattleSim } from '@arena/core/engine/battle';
import { capFor } from '@arena/core/engine/scaling';
import { replayBattle } from '@arena/core/rules';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { SubClass } from '@arena/core/types';
import ArenaCanvas from '../render/ArenaCanvas';
import { weatherSummary } from '@arena/core/content/arenas';
import { CORE_VERSION, type BattleResultDTO } from '@arena/core/contract';
import { getBackend } from '../backend/index';
import { isRemoteMode, applySnapshot, genIdemKey, battleRemoteOf } from '../backend/storeBridge';
import { consumeBattleSim, climbBattleSeed, climbMult } from '../game/battleBuild';
import { makeSimController, DirectSim, type SimController } from '../render/SimController';

// v2.10 体型中文名（UX-7 战场角标用）；与 MainMenu「玩法说明」描述的 10 档一致
const BODY_CN: Record<string, string> = {
  gnome: '侏儒', petite: '精巧', slim: '瘦小', light: '轻捷', medium: '标准',
  heavy: '魁梧', colossal: '巨躯', obese: '肥胖', titan: '泰坦', giant: '巨灵',
};

export default function BattleScreen() {
  const run = useGame((s) => s.run);
  // v3.2 防御：run 为空（异常时序）时渲染兜底，绝不白屏卡死
  if (!run) {
    return (
      <div className="app battle-stage">
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>⏳ 战斗加载中…</div>
          <div className="muted" style={{ fontSize: 12 }}>若长时间停留，请刷新页面重试</div>
        </div>
      </div>
    );
  }
  return <BattleScreenInner run={run} />;
}

function BattleScreenInner({ run }: { run: NonNullable<ReturnType<typeof useGame.getState>['run']> }) {
  const addScore = useGame((s) => s.addScore);
  const collectLoot = useGame((s) => s.collectLoot);
  const recordBattleEval = useGame((s) => s.recordBattleEval);
  const commitGrowth = useGame((s) => s.commitGrowth);
  const removeDeadAllies = useGame((s) => s.removeDeadAllies);
  const setFailures = useGame((s) => s.setFailures); // v2.4 容错计数
  const consumeBurst = useGame((s) => s.consumeBurst);
  const equipped = useGame((s) => s.equipped);
  const battleRemote = useGame((s) => s.battleRemote); // v3.4g 权威回放（观感=结算）
  const battleSpeed = useGame((s) => s.battleSpeed);
  const setBattleSpeed = useGame((s) => s.setBattleSpeed);
  const formation = useGame((s) => s.formation); // v2.3 战前布阵结果
  // v1.8 布阵上下文 + 自动爬塔播放会话
  const battleCtx = useGame((s) => s.battleCtx);
  const climbSession = useGame((s) => s.climbSession);
  const setClimbSession = useGame((s) => s.setClimbSession);
  const setBattleCtx = useGame((s) => s.setBattleCtx);
  const setLayer = useGame((s) => s.setLayer);
  const climbReward = useGame((s) => s.climbReward);

  // v1.7 §4：进入战斗即消耗爆发药剂标记——它只对「下一场」生效
  useEffect(() => {
    run.team.forEach((h) => { if (h.pendingBurst) consumeBurst(h.uid); });
    // 仅在进入某层战斗时执行一次（BattleScreen 在每层开战才挂载）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v1.8：下五层按生效层出图（敌人是「五层后」的强度，再叠 +20%）
  const effLayer = battleCtx.mode === 'skip5' ? run.layer + 5 : run.layer;
  const plan = useMemo(() => genLayer(effLayer, run.seed, run.mode), [effLayer, run.seed, run.mode]);

  // v1.8 战斗修正参数：下五层 = 敌强 ×1.20；自动爬塔 = 逐层 climbMult + 战略 + 专属种子
  const mods = useMemo(() => {
    if (battleCtx.mode === 'skip5') {
      return { effLayer: run.layer + 5, enemyHpMult: 1.2, enemyDmgMult: 1.2 };
    }
    if (battleCtx.mode === 'climb' && climbSession) {
      const cur = climbSession.result.layers[climbSession.idx];
      if (!cur) return undefined;
      return {
        effLayer: cur.layer,
        enemyHpMult: climbMult(climbSession.idx + 1),
        enemyDmgMult: climbMult(climbSession.idx + 1),
        strategy: battleCtx.strategy,
        battleSeed: climbBattleSeed(run.seed, cur.layer),
      };
    }
    return undefined;
  }, [battleCtx, climbSession, run.seed]);

  // vX 进战卡顿修复：原本 sim 在 useMemo 里同步构造，会阻塞倒计时结束后的首帧渲染，
  // 表现为「载入中」式卡顿。改为首帧 paint 后再用 requestAnimationFrame 构造 sim，
  // 先渲染加载页、再建战场，过渡顺滑。
  // v1.5 战斗预载：PreBattle 点「确认开战」时已后台构造好 sim（传参完成即载入引擎），
  // 这里直接消费 → 倒计时三句话播完即开打，不再有「⏳ 战斗加载中…」加载门。
  const preloadedRef = useRef<BattleSim | null | undefined>(undefined);
  // v1.8：自动爬塔播放每层都是新战斗，不吃上一场的预载（避免首帧闪旧战场）
  if (preloadedRef.current === undefined) preloadedRef.current = battleCtx.mode === 'climb' ? null : consumeBattleSim();
  // vX Web Worker 仿真：?simworker=1 且本地模式时优先走 Worker（即便有预载也改运行时在 Worker 内重建，
  // 主线程只渲染）。远程模式 / 无 flag 时回落到预载（若有）包 DirectSim，保持历史平滑进战体验。
  const preferWorker =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('simworker') === '1';
  // vX Web Worker 仿真：sim 现为 SimController（DirectSim 默认 / SimClient 走 Worker）。
  // 非 Worker 模式且预载命中 → 直接包进 DirectSim（零构造开销，历史行为）；否则先 null，等 effect 运行时构造。
  const [sim, setSim] = useState<SimController | null>(
    !preferWorker && preloadedRef.current ? new DirectSim(preloadedRef.current) : null,
  );

  useEffect(() => {
    // 预载命中且非 Worker 模式：沿用 state 初始的 DirectSim，跳过运行时构造（历史平滑体验）
    if (preloadedRef.current && !preferWorker) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      // vX Web Worker 仿真：统一经 makeSimController 构造控制器。
      // 默认 DirectSim（主线程，行为与历史一致）；?simworker=1 且本地模式走 Worker，失败自动回退。
      // 云端回放分支由 DirectSim 内部经 buildBattleSim → makeSim 处理，parity 逐 bit 一致。
      const ctrl = makeSimController({ run, plan, equipped, formation, battleRemote, mods });
      if (!cancelled) setSim(ctrl);
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, plan, equipped, formation, battleRemote, mods]);

  // vX Web Worker 仿真：控制器（尤其 SimClient 的 Worker 线程）在 sim 变更/卸载时释放，避免跨层/退场泄漏
  useEffect(() => {
    return () => { sim?.dispose(); };
  }, [sim]);

  // v1.8 自动爬塔逐层续战：换层后清除预载引用，让上面的构造 effect 为「新层」重建 sim
  useEffect(() => {
    if (battleCtx.mode === 'climb' && preloadedRef.current !== undefined) {
      preloadedRef.current = undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.layer]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 150);
    return () => clearInterval(t);
  }, []);

  // 暂停：与倍速刻意分开。倍速是「我想看多快」的长期偏好（持久化到 store），
  // 暂停是「我现在要看清这一瞬间」的临时动作，切层后必须自动恢复，所以留在组件本地 state。
  const [paused, setPaused] = useState(false);
  // v3.2 战斗结束横幅：胜利/失败中央大字挂 2s，再进入结算
  const [banner, setBanner] = useState<'win' | 'lose' | null>(null);
  useEffect(() => { setPaused(false); }, [run.layer]);

  const subclasses = useMemo(
    () => Array.from(new Set(run.team.map((h) => h.subclass))) as SubClass[],
    [run.team],
  );

  // ── 云端模式：进战斗即让 Edge 权威结算，本地仅播放权威回放（观感=结算）──
  const setBattleRemote = useGame((s) => s.setBattleRemote);
  // 幂等 key 复用：onEnd 兜底重试用同一个 key，云端不会重复结算同一层
  const battleKeyRef = useRef<string | null>(null);
  // 云端模式：本地用服务端回放复现战斗过程，比对 checksum；结果回传 ackBattle
  // （battles.client_checksum 落库 + 漂移日志）。fire-and-forget，不阻塞对局播放。
  const ackParity = useCallback(async (
    battleId: string,
    replay: BattleResultDTO['replay'],
    env: { runId: string; idempotencyKey: string; coreVersion: string },
  ) => {
    try {
      const { checksum } = replayBattle(replay);
      const a = await getBackend().ackBattle({ battleId, localChecksum: checksum, ...env });
      if (a.ok && !a.data.checksumMatch) {
        console.warn('[drift] 本地复现与后端不一致 battle=', battleId, 'client=', checksum);
      }
    } catch (e) {
      console.warn('[arena] parity ack 失败（不影响对局）:', e);
    }
  }, []);

  // v3.4g 抽成可重试函数：首取失败不再"卡在进入战场"（无 sim 即无 onEnd）
  const fetchBattle = useCallback(async () => {
    const runId = run.runId;
    const key = battleKeyRef.current ?? genIdemKey();
    battleKeyRef.current = key;
    try {
      const r = await getBackend().startBattle({
        runId,
        idempotencyKey: key,
        coreVersion: CORE_VERSION,
        formation: useGame.getState().formation,
        clientTs: Date.now(),
      });
      if (r.ok) {
        setBattleRemote(battleRemoteOf(r.data));
        // 用权威回放本地复现校验前后端一致性（仅云端模式需要，本地模式本就同进程）
        void ackParity(r.data.battleId, r.data.replay, { runId, idempotencyKey: key, coreVersion: CORE_VERSION });
      } else console.warn('[arena] 云端结算失败:', r.code, r.message);
    } catch (e) {
      console.warn('[arena] 云端结算异常:', e);
    }
  }, [run.runId, setBattleRemote, ackParity]);
  useEffect(() => {
    if (!isRemoteMode()) return;
    // v1.8.1 优先采用爬塔间隙预热好的回放，消除「正在进入战场」黑屏
    const pf = useGame.getState().prefetchBattle;
    const ctxMode = useGame.getState().battleCtx.mode;
    if (pf && pf.mode === ctxMode && pf.runLayer === run.layer) {
      setBattleRemote(battleRemoteOf(pf.data));
      battleKeyRef.current = pf.key; // 复用预热时的幂等 key，后端不重复结算
      useGame.getState().setPrefetchBattle(null);
      void ackParity(pf.data.battleId, pf.data.replay, { runId: run.runId, idempotencyKey: pf.key, coreVersion: CORE_VERSION });
      return;
    }
    setBattleRemote(null);
    void fetchBattle();
    // 仅在进入某层战斗时执行一次（BattleScreen 在每层开战才挂载）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.layer, run.runId]);

  // v3.2 战斗结算主体（banner 结束后执行）：云端用权威快照，本地用模拟结果
  const settle = useCallback((result: 'win' | 'lose') => {
    const snap = useGame.getState().run;
    if (!snap) return;
    if (!sim) return; // vX sim 尚未构造（加载中）时不结算；settle 只在战斗结束时被调用，届时 sim 已就绪
    const cap2 = capFor(snap.mode);
    const next2 = snap.layer + 1;

    if (isRemoteMode()) {
      void (async () => {
        let remote = useGame.getState().battleRemote;
        if (!remote) {
          // 结算未就绪（Edge 冷启动/网络慢/首取失败）：同步补一次，同幂等 key 防重复结算
          try {
            const r = await getBackend().startBattle({
              runId: snap.runId,
              idempotencyKey: battleKeyRef.current ?? genIdemKey(),
              coreVersion: CORE_VERSION,
              formation: useGame.getState().formation,
              clientTs: Date.now(),
            });
            if (r.ok) { remote = battleRemoteOf(r.data); useGame.getState().setBattleRemote(remote); }
          } catch (e) {
            console.warn('[arena] 云端结算两次失败，停留在当前层:', e);
          }
        }
        if (remote) {
          applySnapshot(useGame.setState, remote.snapshot);
          const outcome = remote.outcome;
          if (outcome.result === 'win') {
            recordBattleEval(outcome.stats, 'win', snap.layer, next2, cap2, {
              uid: outcome.mvpUid ?? null, stat: outcome.mvpStat ?? null, add: outcome.mvpAdd ?? 0,
            });
          } else {
            recordBattleEval(outcome.stats, 'lose', snap.layer, snap.layer, cap2, {
              uid: null, stat: null, add: 0,
            });
          }
        }
      })();
      return;
    }

    // v1.8.3 三存档：本地模式战斗结算后自动保存当前槽（爬塔逐层不存，避免频繁写 localStorage）
    if (useGame.getState().battleCtx.mode !== 'climb') useGame.getState().saveToSlot();

    if (result === 'win') {
      // v1.7 §2：把本场击杀成长写回对应副本（已按 heroUid 累加）
      commitGrowth(sim.getKillGains());
      // v2.2 铁人无尽（permadeath）：把本场阵亡的友方副本永久移除，下一场不再重建。
      if (snap.mode === 'ironman') {
        const dead = sim.getDeadAllyUids();
        if (dead.length) removeDeadAllies(dead);
      }
      const ctxNow = useGame.getState().battleCtx;

      // ── v1.8 下五层胜利：五层奖励（含高奖 +10%）+ 层跳到 N+5 ──
      if (ctxNow.mode === 'skip5') {
        const layers = [snap.layer + 1, snap.layer + 2, snap.layer + 3, snap.layer + 4, snap.layer + 5];
        const gain = layers.reduce((a, L) => a + (100 * L + 50), 0);
        addScore(gain);
        collectLoot(snap.layer, { layers, highBonus: true, poolLayer: snap.layer + 5 });
        setLayer(snap.layer + 5);
        setBattleCtx({ mode: 'normal' });
        recordBattleEval(sim.getBattleStats(), 'win', snap.layer + 5, snap.layer + 6, cap2);
        return;
      }

      // ── v1.8 自动爬塔：逐层播放 ──
      if (ctxNow.mode === 'climb' && useGame.getState().climbSession) {
        const cs = useGame.getState().climbSession!;
        const cur = cs.result.layers[cs.idx];
        if (cur?.win) climbReward(cur.gold, cur.drops); // 本层奖励按 headless 结果入账
        const stop = cs.stopRequested || cs.idx + 1 >= cs.result.layers.length;
        if (stop) {
          // 打完 / 玩家点了「本层后停止」：爬塔结束，回休整
          useGame.getState().setClimbSession(null);
          setBattleCtx({ mode: 'normal' });
          recordBattleEval(sim.getBattleStats(), 'win', cur?.layer ?? snap.layer, (cur?.layer ?? snap.layer) + 1, cap2);
          return;
        }
        // 自动续战下一层（setLayer 触发 BattleScreen 重挂，直接进下一场，不打断）
        const next = cs.result.layers[cs.idx + 1];
        useGame.getState().setClimbSession({ ...cs, idx: cs.idx + 1 });
        setLayer(next.layer);
        return;
      }

      // ── 普通胜利 ──
      const gain = 100 * snap.layer + 50;
      addScore(gain);
      // 胜利掉落照常结算（战报屏之后才进休整屏，掉落需在休整屏可见）
      if (next2 <= cap2) collectLoot(snap.layer);
      // v2.9.6：先落到战后评价屏，继续按钮再决定去休整 / 通关结算
      recordBattleEval(sim.getBattleStats(), 'win', snap.layer, next2, cap2);
    } else {
      const ctxNow = useGame.getState().battleCtx;

      // ── v1.8 自动爬塔失败层：扣一次容错（「扣一次挑战机会」），爬塔结束 ──
      if (ctxNow.mode === 'climb' && useGame.getState().climbSession) {
        const cur = useGame.getState().climbSession!.result.layers[useGame.getState().climbSession!.idx];
        useGame.getState().setClimbSession(null);
        setBattleCtx({ mode: 'normal' });
        const failures = (snap.failures ?? 0) + 1;
        setFailures(failures);
        recordBattleEval(sim.getBattleStats(), 'lose', cur?.layer ?? snap.layer, cur?.layer ?? snap.layer, cap2);
        return;
      }

      // ── v1.8 下五层失败：扣 2 次容错 ──
      if (ctxNow.mode === 'skip5') {
        const failures = (snap.failures ?? 0) + 2;
        setFailures(failures);
        setBattleCtx({ mode: 'normal' }); // v2.10 修复：失败也复位，否则后续"下一层"仍按 skip5 出战
        recordBattleEval(sim.getBattleStats(), 'lose', effLayer, effLayer, cap2);
        return;
      }

      // v2.4 容错：允许失败 2 次，第 3 次才真正结束。
      // 前两次失败不清空队伍（即使铁人模式，也只在胜利时永久移除阵亡者）。
      // v2.9.6：失败也先看战报（异常关卡能看出数据），继续按钮再决定重试 / 结束。
      const failures = (snap.failures ?? 0) + 1;
      setFailures(failures);
      recordBattleEval(sim.getBattleStats(), 'lose', snap.layer, snap.layer, cap2);
    }
  }, [sim, recordBattleEval, commitGrowth, collectLoot, removeDeadAllies, addScore, setFailures,
      setLayer, setBattleCtx, climbReward, effLayer]);

  const onEnd = useCallback((result: 'win' | 'lose') => {
    // v3.2 战斗结束横幅挂 2s（胜利/失败中央大字），再进入结算/战报——给玩家情绪落点，也给后端结算留缓冲
    if (banner) return;
    // vX 远程模式：横幅以云端权威结果为准（观感=结算）。本地回放若与云端发生漂移，
    // 动画可能演示「胜」但落库为「败」——横幅必须跟实际结算一致，否则玩家看到「胜利」却没推进层。
    const shown = isRemoteMode()
      ? (useGame.getState().battleRemote?.outcome.result ?? result)
      : result;
    setBanner(shown);
    setTimeout(() => {
      setBanner(null);
      try {
        settle(result);
      } catch (e) {
        // v3.2 防御：结算异常绝不静默卡死，打日志并强制进战报
        console.error('[arena] 战斗结算异常:', e);
        try {
          const snap = useGame.getState().run;
          if (snap) recordBattleEval([], result, snap.layer, snap.layer, capFor(snap.mode), { uid: null, stat: null, add: 0 });
        } catch { /* 双重兜底失败则留在当前屏 */ }
      }
    }, 2000);
  }, [banner, settle, recordBattleEval]);

  // vX 加载门：sim 尚未构造完成时显示加载页（已首帧 paint，无卡顿）
  if (!sim) {
    return (
      <div className="app battle-stage">
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>⏳ 战斗加载中…</div>
          <div className="muted" style={{ fontSize: 12 }}>正在部署战场与单位…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app battle-stage">
      {/* HUD：顶部居中悬浮玻璃条（v1.9.0 #2c 全屏播放） */}
      <div className="hud battle-hud">
        <span>第 {run.layer} 层</span>
        <span>积分 {run.score}</span>
        <span className="muted">剩余敌 {sim.units.filter((u) => u.side === 'enemy' && u.alive).length}</span>
        {/* v1.5 天气小标签：右上角常驻，不挡战斗视野（美术 §3.4.5） */}
        {plan.arena.weather && (
          <span className="weather-chip">
            {plan.arena.weather.icon} {plan.arena.weather.cn} · {weatherSummary(plan.arena.weather)}
          </span>
        )}
        {plan.eliteBoss && (
          <span className="elite-chip" title="精英 Boss 层：强化头目">
            👑 精英Boss
          </span>
        )}
      </div>

      {/* v3.4g 云端开战中：等待权威回放就绪才开画（不渲染本地 sim，权威种子不下发） */}
      {isRemoteMode() && !battleRemote?.replay ? (
        <div className="battle-wait">
          <span>⚔ 正在进入战场…</span>
          <button className="tag" style={{ padding: '6px 16px', cursor: 'pointer', background: 'rgba(10,12,20,0.9)' }} onClick={() => void fetchBattle()}>
            网络较慢？点此重试
          </button>
        </div>
      ) : (
        <div className="battle-canvas-area">
          <ArenaCanvas sim={sim} running={!sim.over && !paused} speed={battleSpeed} onEnd={onEnd} />
        </div>
      )}

      {/* v1.6 §A.2：倍速读写 store，跨层/跨会话保持——组件重建不再吞掉玩家的设置。
          v1.9.0 #2c：倍速/暂停改为底部居中悬浮窗，覆盖在播放上方 */}
      <div className="speedbar battle-speed-float">
        <button
          className={'pause-btn' + (paused ? ' paused' : '')}
          onClick={() => setPaused((p) => !p)}
          disabled={sim.over}
          title={paused ? '继续战斗' : '暂停战斗'}
        >
          {paused ? '▶ 继续' : '❚❚ 暂停'}
        </button>
        <span className="speed-label">倍速</span>
        <input
          className="speed-range"
          type="range"
          min={0.5}
          max={4}
          step={0.5}
          value={battleSpeed}
          onChange={(e) => setBattleSpeed(parseFloat(e.target.value))}
          aria-label="战斗倍速"
        />
        <span className="speed-value">{battleSpeed.toFixed(1)}×</span>
        <div className="speed-presets">
          {SPEED_OPTIONS.map((v) => (
            <button
              key={v}
              className={'speed-chip' + (Math.abs(battleSpeed - v) < 1e-6 ? ' active' : '')}
              onClick={() => setBattleSpeed(v)}
            >
              {v}×
            </button>
          ))}
        </div>
      </div>

      {/* 技能条：底部居中悬浮于倍速上方（v1.9.0 #2c） */}
      <div className="skillbar battle-skill-float">
        {subclasses.map((sc) => {
          const u = sim.units.find((x) => x.alive && x.side === 'ally' && x.subclass === sc);
          const cd = u ? u.skillCd : 0;
          const ready = cd <= 0;
          return (
            <button
              key={sc}
              className="skill-btn"
              disabled={!ready}
              style={{ borderColor: SUBCLASS_INFO[sc].color, color: SUBCLASS_INFO[sc].color }}
              onClick={() => sim.forceCast(sc)}
              title={SUBCLASS_INFO[sc].cn}
            >
              <span className="skill-name">{SUBCLASS_INFO[sc].cn}</span>
              {/* v2.10 体型/性别角标（UX-7）：每局随机但原无视觉提示；图标+文字双通道，色盲可辨 */}
              {u && (
                <span className="unit-tag" title={`体型：${BODY_CN[u.bodyType] ?? u.bodyType} · 性别：${u.gender === 'female' ? '女 ♀' : '男 ♂'}`}>
                  {BODY_CN[u.bodyType] ?? u.bodyType}{u.gender === 'female' ? '♀' : '♂'}
                </span>
              )}
              {!ready && <span className="skill-cd">{cd.toFixed(1)}</span>}
            </button>
          );
        })}
      </div>

      {/* 副标题提示：全屏下缩为左上角小字（v1.9.0 #2c） */}
      <div className="subtitle battle-sub-float">
        {paused ? '已暂停 · 点击「继续」恢复战斗' : '自动战斗进行中 · 点击技能可手动施放'}
      </div>

      {/* v1.8 自动爬塔：进度 + 上浮「本层后停止」按钮（打完当前层即停，保留已获奖励） */}
      {battleCtx.mode === 'climb' && climbSession && (
        <div className="climb-float">
          <span className="tag" style={{ color: '#ffd76a', borderColor: '#c9a33f' }}>
            🔴 自动爬塔 {climbSession.idx + 1}/{climbSession.result.layers.length}
          </span>
          {!climbSession.stopRequested && (
            <button
              className="chip"
              style={{ color: '#ff8a8a', borderColor: '#c93f3f', background: 'rgba(125,46,46,0.25)', cursor: 'pointer' }}
              onClick={() => setClimbSession({ ...climbSession, stopRequested: true })}
            >
              ⏹ 本层后停止爬塔
            </button>
          )}
        </div>
      )}

      {/* v3.2 战斗结束横幅：胜利/失败中央大字挂 2s */}
      {banner && (
        <div className="banner">
          <div className={'banner__title ' + (banner === 'win' ? 'win' : 'lose')}>
            {banner === 'win' ? '⚔ 胜 利' : '💀 战 败'}
          </div>
          <div className="banner__sub">{banner === 'win' ? '敌方已被歼灭' : '队伍已溃败'}</div>
        </div>
      )}
    </div>
  );
}
