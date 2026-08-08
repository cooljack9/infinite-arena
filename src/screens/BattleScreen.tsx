import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame, SPEED_OPTIONS } from '../game/state/store';
import { genLayer } from '@arena/core/gen/levelGen';
import { makeAlly, makeEnemy } from '@arena/core/engine/unit';
import { applyRelics, BattleSim } from '@arena/core/engine/battle';
import { enemyScale, capFor } from '@arena/core/engine/scaling';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { SubClass, Unit } from '@arena/core/types';
import ArenaCanvas from '../render/ArenaCanvas';
import { weatherSummary } from '@arena/core/content/arenas';
import { enemyPlacements, sanitizeFormation } from '@arena/core/gen/formation';
import { CORE_VERSION } from '@arena/core/contract';
import { getBackend } from '../backend/index';
import { isRemoteMode, applySnapshot, genIdemKey, battleRemoteOf } from '../backend/storeBridge';

export default function BattleScreen() {
  const run = useGame((s) => s.run);
  // v3.2 防御：run 为空（异常时序）时渲染兜底，绝不白屏卡死
  if (!run) {
    return (
      <div className="app">
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

  // v1.7 §4：进入战斗即消耗爆发药剂标记——它只对「下一场」生效
  useEffect(() => {
    run.team.forEach((h) => { if (h.pendingBurst) consumeBurst(h.uid); });
    // 仅在进入某层战斗时执行一次（BattleScreen 在每层开战才挂载）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = useMemo(() => genLayer(run.layer, run.seed, run.mode), [run.layer, run.seed, run.mode]);

  const sim = useMemo(() => {
    // v3.4g 云端模式：直接播放权威回放（云端算好的单位 + battleSeed），观感 = 结算结果；
    // 权威根种子永不下发（replay.battleSeed 只对单层战斗有效，无法反推全局）。
    if (isRemoteMode() && battleRemote?.replay) {
      const rp = battleRemote.replay;
      const s = new BattleSim([...rp.allies, ...rp.enemies], rp.arena, rp.battleSeed);
      s.setBuildingScale(rp.buildingScale.hp, rp.buildingScale.dmg);
      if (rp.buildings.length) s.spawnBuildings(rp.buildings, rp.layer, rp.buildingScale.hp, rp.buildingScale.dmg);
      return s;
    }
    // v2.3：站位来自战前布阵；地图每层可能换布局，故仍需按当前地图合法化一次。
    // （旧实现是 spawnAlly[i % 1]，三名队员会全部叠在同一格由分离力炸开）
    const spots = sanitizeFormation(
      plan.arena,
      run.team.map((h) => formation[h.uid]),
      plan.spawnAlly[0],
      run.team.length,
    );
    const allies: Unit[] = run.team.map((h, i) => {
      const eqs = equipped[h.uid] ?? [];
      const u = makeAlly(h, 1 + Math.floor((run.layer - 1) / 2), eqs, { burst: !!h.pendingBurst });
      const p = spots[i];
      u.x = p.x; u.y = p.y;
      return u;
    });
    applyRelics(allies, run.relics);

    const scale = enemyScale(run.layer);
    const eLevel = 1 + Math.floor(run.layer / 4);
    // v2.3：敌方同样从「一坨」改为 BFS 列阵展开，Boss 独占中央高台
    const defs = plan.waves.flat();
    const eSpots = enemyPlacements(plan.arena, plan.spawnEnemy, plan.bossPos, defs);
    const enemies: Unit[] = defs.map((e, i) => {
      const u = makeEnemy(e, eLevel, scale.hp, scale.dmg);
      const p = eSpots[i];
      u.x = p.x; u.y = p.y;
      return u;
    });

    const s = new BattleSim([...allies, ...enemies], plan.arena, (run.seed + run.layer) >>> 0);
    // v2.6 §3：敌方补给建筑。落点由 levelGen 确定性生成（同 seed 同层必然同图），
    // 血量/伤害吃与波次怪同一条层深缩放线，避免深层时建筑脆得像纸。
    s.setBuildingScale(scale.hp, scale.dmg);
    if (plan.buildings.length) s.spawnBuildings(plan.buildings, run.layer, scale.hp, scale.dmg);
    return s;
  }, [run, plan, equipped, formation, battleRemote]);

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
      if (r.ok) setBattleRemote(battleRemoteOf(r.data));
      else console.warn('[arena] 云端结算失败:', r.code, r.message);
    } catch (e) {
      console.warn('[arena] 云端结算异常:', e);
    }
  }, [run.runId, setBattleRemote]);
  useEffect(() => {
    if (!isRemoteMode()) return;
    setBattleRemote(null);
    void fetchBattle();
    // 仅在进入某层战斗时执行一次（BattleScreen 在每层开战才挂载）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.layer, run.runId]);

  // v3.2 战斗结算主体（banner 结束后执行）：云端用权威快照，本地用模拟结果
  const settle = useCallback((result: 'win' | 'lose') => {
    const snap = useGame.getState().run;
    if (!snap) return;
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

    if (result === 'win') {
      // v1.7 §2：把本场击杀成长写回对应副本（已按 heroUid 累加）
      commitGrowth(sim.getKillGains());
      // v2.2 铁人无尽（permadeath）：把本场阵亡的友方副本永久移除，下一场不再重建。
      if (snap.mode === 'ironman') {
        const dead = sim.getDeadAllyUids();
        if (dead.length) removeDeadAllies(dead);
      }
      const gain = 100 * snap.layer + 50;
      addScore(gain);
      // 胜利掉落照常结算（战报屏之后才进休整屏，掉落需在休整屏可见）
      if (next2 <= cap2) collectLoot(snap.layer);
      // v2.9.6：先落到战后评价屏，继续按钮再决定去休整 / 通关结算
      recordBattleEval(sim.getBattleStats(), 'win', snap.layer, next2, cap2);
    } else {
      // v2.4 容错：允许失败 2 次，第 3 次才真正结束。
      // 前两次失败不清空队伍（即使铁人模式，也只在胜利时永久移除阵亡者）。
      // v2.9.6：失败也先看战报（异常关卡能看出数据），继续按钮再决定重试 / 结束。
      const failures = (snap.failures ?? 0) + 1;
      setFailures(failures);
      recordBattleEval(sim.getBattleStats(), 'lose', snap.layer, snap.layer, cap2);
    }
  }, [sim, recordBattleEval, commitGrowth, collectLoot, removeDeadAllies, addScore, setFailures]);

  const onEnd = useCallback((result: 'win' | 'lose') => {
    // v3.2 战斗结束横幅挂 2s（胜利/失败中央大字），再进入结算/战报——给玩家情绪落点，也给后端结算留缓冲
    if (banner) return;
    setBanner(result);
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

  return (
    <div className="app">
      <div className="battle-wrap">
        <div className="hud">
          <span>第 {run.layer} 层</span>
          <span>积分 {run.score}</span>
          <span className="muted">剩余敌 {sim.units.filter((u) => u.side === 'enemy' && u.alive).length}</span>
          {/* v1.5 天气小标签：右上角常驻，不挡战斗视野（美术 §3.4.5） */}
          {plan.arena.weather && (
            <span style={{ marginLeft: 'auto', color: '#9fe8ff', fontSize: 12 }}>
              {plan.arena.weather.icon} {plan.arena.weather.cn} · {weatherSummary(plan.arena.weather)}
            </span>
          )}
          {plan.eliteBoss && (
            <span style={{ color: '#ff5f6d', fontWeight: 700, fontSize: 12 }} title="精英 Boss 层：强化头目">
              👑 精英Boss
            </span>
          )}
        </div>
        {/* v3.4g 云端开战中：等待权威回放就绪才开画（不渲染本地 sim，权威种子不下发） */}
        {isRemoteMode() && !battleRemote?.replay ? (
          <div className="panel" style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, fontSize: 15, color: '#ffd76a' }}>
            <span>⚔ 正在进入战场…</span>
            <button className="tag" style={{ padding: '6px 16px', cursor: 'pointer', background: 'rgba(10,12,20,0.9)' }} onClick={() => void fetchBattle()}>
              网络较慢？点此重试
            </button>
          </div>
        ) : (
          <ArenaCanvas sim={sim} running={!sim.over && !paused} speed={battleSpeed} onEnd={onEnd} />
        )}
        {/* v1.6 §A.2：倍速读写 store，跨层/跨会话保持——组件重建不再吞掉玩家的设置 */}
        <div className="speedbar">
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
        <div className="skillbar">
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
                {SUBCLASS_INFO[sc].cn}
                {!ready && <span className="skill-cd">{cd.toFixed(1)}</span>}
              </button>
            );
          })}
        </div>
        <div className="subtitle">
          {paused ? '已暂停 · 点击「继续」恢复战斗' : '自动战斗进行中 · 点击技能可手动施放'}
        </div>
      </div>

      {/* v3.2 战斗结束横幅：胜利/失败中央大字挂 2s */}
      {banner && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
          }}
        >
          <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: 6, animation: 'countdown-pop 0.8s ease-in-out' }}>
            {banner === 'win' ? <span style={{ color: '#ffd76a' }}>⚔ 胜 利</span> : <span style={{ color: '#ff6a6a' }}>💀 战 败</span>}
          </div>
          <div style={{ color: '#999', fontSize: 13 }}>{banner === 'win' ? '敌方已被歼灭' : '队伍已溃败'}</div>
        </div>
      )}
    </div>
  );
}
