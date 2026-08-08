import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../game/state/store';
import { genLayer } from '@arena/core/gen/levelGen';
import { PRE_BATTLE_POOL } from '@arena/core/content/talents';
import { RELIC_BY_ID } from '@arena/core/content/relics';
import { EnemyDef, Vec2 } from '@arena/core/types';
import FormationEditor from './FormationEditor';
import { enemyPlacements, sanitizeFormation } from '@arena/core/gen/formation';
import { mulberry32, shuffle } from '@arena/core/engine/rng';
import { bossLineFor } from '@arena/core/content/story';
import { weatherSummary } from '@arena/core/content/arenas';
import { capFor } from '@arena/core/engine/scaling';
import TutorialOverlay from './TutorialOverlay';

export default function PreBattle() {
  const run = useGame((s) => s.run)!;
  const addRelic = useGame((s) => s.addRelic);
  const setScreen = useGame((s) => s.setScreen);
  const bestLayer = useGame((s) => s.bestLayer);
  const addScore = useGame((s) => s.addScore);
  const collectLoot = useGame((s) => s.collectLoot);
  const finishBattle = useGame((s) => s.finishBattle);
  const savedFormation = useGame((s) => s.formation);
  const setFormation = useGame((s) => s.setFormation);
  const formationPreset = useGame((s) => s.formationPreset);
  const resolvedEvents = useGame((s) => s.resolvedEvents);
  const resolveRandomEvent = useGame((s) => s.resolveRandomEvent);
  const seenArenaHints = useGame((s) => s.seenArenaHints);
  const markArenaSeen = useGame((s) => s.markArenaSeen);
  const gold = useGame((s) => s.gold);
  const inventory = useGame((s) => s.inventory);

  const plan = useMemo(() => genLayer(run.layer, run.seed, run.mode), [run.layer, run.seed, run.mode]);
  const choices = useMemo(() => {
    const rng = mulberry32((run.seed + run.layer * 31) >>> 0);
    return shuffle(rng, PRE_BATTLE_POOL).slice(0, 3);
  }, [run.seed, run.layer]);
  const [picked, setPicked] = useState<string | null>(null);

  const enemyPreview: EnemyDef[] = plan.waves.flat();
  const enemyCount = enemyPreview.length;
  const bossLine = bossLineFor(run.layer);

  // ── v2.3 战前布阵 ──
  // 每层可能抽到不同布局（A1/A3/A6），旧坐标未必仍合法，
  // 所以先按当前地图把已保存站位吸附一遍，再交给玩家微调。
  const initialForm = useMemo(() => {
    const pts = sanitizeFormation(
      plan.arena,
      run.team.map((h) => savedFormation[h.uid]),
      plan.spawnAlly[0],
      run.team.length,
    );
    const m: Record<string, Vec2> = {};
    run.team.forEach((h, i) => { m[h.uid] = pts[i]; });
    return m;
    // savedFormation 刻意不入依赖：它是本组件的写出目标，入依赖会形成自激回环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.arena, run.team]);

  const [form, setForm] = useState<Record<string, Vec2>>(initialForm);
  const [preset, setPreset] = useState(formationPreset);
  useEffect(() => { setForm(initialForm); }, [initialForm]);
  // v3.2 开战三段过场（准备完毕！→ 正在递交战书。→ 对决开始！）：给后端留结算时间，避免进战斗瞬间突兀
  const [countdown, setCountdown] = useState(0);
  const COUNTDOWN_LABEL = ['', '对决开始！', '正在递交战书。', '准备完毕！'] as const; // index = countdown

  // 与 BattleScreen 调用同一个纯函数，保证预览红点 = 实际开场落点
  const enemySpots = useMemo(
    () => enemyPlacements(plan.arena, plan.spawnEnemy, plan.bossPos, enemyPreview),
    [plan, enemyPreview],
  );

  const confirm = () => {
    if (picked) addRelic(RELIC_BY_ID[picked]);
    setFormation(form, preset);
    if (countdown > 0) return; // 已在过场
    // 三段过场进战斗（状态驱动，见下方 useEffect）：期间 BattleScreen 挂载即发 startBattle
    setCountdown(3);
  };

  // v3.2 倒计时状态机：countdown 3→2→1→0，0 时切 battle；组件卸载自动清理定时器
  useEffect(() => {
    if (countdown === 0) return;
    const t = setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else { setCountdown(0); setScreen('battle'); }
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // v2.0 跳过已通关层（需求文档 §5.1 P0：战斗跳过按钮，直接结算已通关层数）
  // 仅当本层曾被打通过（layer <= bestLayer）且仍在深塔范围内时可用。
  const canSkip = run.layer <= bestLayer && run.layer > 0;
  const skip = () => {
    const gain = 100 * run.layer + 50;
    addScore(gain);
  // v2.2：新手模式在封顶层（NOVICE_CAP=5）跳过 = 通关并解锁普通无尽 + 铁人无尽；
  // 普通无尽 / 铁人无尽在封顶层（ENDLESS_CAP=500）跳过 = 登顶胜利。两者都直接结算为通关。
    if (run.layer >= capFor(run.mode)) {
      finishBattle(true, run.layer, run.score + gain);
      return;
    }
    collectLoot(run.layer);
    setScreen('inter');
  };

  return (
    <div className="app">
      <div className="panel col">
        <div className="title" style={{ fontSize: 18 }}>第 {run.layer} 层 · {plan.arena.name}</div>
        {/* v3.4e 特殊地图首次出现说明（八角笼 / 疯狂龙巢；本局只提示一次，点「知道了」关闭） */}
        {plan.arena.id === 'CAGE' && !seenArenaHints.includes('CAGE') && (
          <div style={{ marginTop: 8, padding: '10px 12px', borderLeft: '3px solid #ff5d3a', background: 'rgba(255,93,58,0.10)', fontSize: 13, lineHeight: 1.7 }}>
            <b style={{ color: '#ff8a6a' }}>🔥 真男人八角笼</b>　全场岩浆，只有中央平台可以立足——站在岩浆上会<b>每秒灼烧 3% 生命</b>！
            把战斗控制在中央，别让敌方把你逼进边路火海。
            <button
              className="chip"
              style={{ marginLeft: 8, color: '#ffd76a', borderColor: '#ffd76a88', cursor: 'pointer', background: 'transparent' }}
              onClick={() => markArenaSeen('CAGE')}
            >知道了</button>
          </div>
        )}
        {plan.arena.id === 'DRAGON' && !seenArenaHints.includes('DRAGON') && (
          <div style={{ marginTop: 8, padding: '10px 12px', borderLeft: '3px solid #ff5d3a', background: 'rgba(255,93,58,0.10)', fontSize: 13, lineHeight: 1.7 }}>
            <b style={{ color: '#ff8a6a' }}>🐉 疯狂龙巢</b>　地图里藏着 <b>3~5 个龙巢</b>，会持续喷出恶龙！
            优先集火龙巢，别让龙潮滚雪球。
            <button
              className="chip"
              style={{ marginLeft: 8, color: '#ffd76a', borderColor: '#ffd76a88', cursor: 'pointer', background: 'transparent' }}
              onClick={() => markArenaSeen('DRAGON')}
            >知道了</button>
          </div>
        )}
        <div className="row">
          {plan.isVacuum && <span className="chip" style={{ color: '#ffcc4d' }}>⚠ 真空期：敌弱速快</span>}
          {plan.isMutation && <span className="chip" style={{ color: '#ff4a4a' }}>突变层：{plan.mutationRule}</span>}
          {plan.bossTier === 'strong' && <span className="chip" style={{ color: '#ff2e2e' }}>★ 强力 Boss 层</span>}
          {plan.bossTier === 'normal' && <span className="chip" style={{ color: '#ffae00' }}>Boss 层</span>}
          {plan.eliteBoss && <span className="chip" style={{ color: '#ff2e2e', borderColor: '#ff2e2e', fontWeight: 700 }}>👑 精英 Boss 层 · 强化头目</span>}
          {run.failures > 0 && (
            <span className="chip" style={{ color: '#9fd0ff' }}>
              剩余容错：{Math.max(0, 2 - run.failures)} 次
            </span>
          )}
        </div>
        {/* v1.5 天气横幅：顶部一条，告知本层环境增益（双方共享，不偏袒任一方） */}
        {plan.arena.weather && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              borderLeft: '3px solid #6fe0ff',
              background: 'rgba(111,224,255,0.08)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <b style={{ color: '#9fe8ff' }}>{plan.arena.weather.icon} {plan.arena.weather.cn}：</b>
            <span style={{ color: '#cdeefb' }}>{weatherSummary(plan.arena.weather)}（双方共享）</span>
          </div>
        )}
        {bossLine && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              borderLeft: '3px solid #ff4a4a',
              background: 'rgba(255,74,74,0.08)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <b style={{ color: '#ff8a8a' }}>{bossLine.boss}：</b>
            <span style={{ color: '#e8d2d2' }}>{bossLine.line}</span>
          </div>
        )}
        {/* ⚡ 随机奇遇事件：战前抉择，确定性结算（需求：随机事件） */}
        {plan.randomEvent && !resolvedEvents.includes(run.layer) && (() => {
          const ev = plan.randomEvent!;
          return (
            <div
              style={{
                marginTop: 8,
                padding: '10px 12px',
                border: '1px solid #6a4ad0',
                borderRadius: 8,
                background: 'rgba(106, 74, 208, 0.10)',
              }}
            >
              <div className="subtitle" style={{ marginTop: 0, color: '#c9b6ff', textAlign: 'left' }}>
                ⚡ 奇遇事件：{ev.title}
              </div>
              <div style={{ fontSize: 12, color: '#d8ccf5', lineHeight: 1.6, marginBottom: 8 }}>{ev.desc}</div>
              <div className="row">
                {ev.options.map((o, i) => {
                  // 门槛：钱不够 / 没东西可献祭 → 直接禁用，不让玩家点了才发现无效
                  const needGold = o.effect.gold && o.effect.gold < 0 ? -o.effect.gold : 0;
                  const noGold = needGold > gold;
                  const noItem = !!o.effect.sacrificeLowest && inventory.length === 0;
                  const blocked = noGold || noItem;
                  return (
                    <button
                      key={i}
                      style={{ flex: '1 1 30%', minWidth: 110, textAlign: 'left', lineHeight: 1.4 }}
                      disabled={blocked}
                      onClick={() => resolveRandomEvent(run.layer, i)}
                      title={noGold ? `金币不足（需 ${needGold}）` : noItem ? '背包里没有可献祭的装备' : o.desc}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{o.label}</div>
                      <div className="tag" style={{ color: '#b9a8e0' }}>
                        {noGold ? `金币不足（需 ${needGold}）` : noItem ? '背包为空，无法献祭' : o.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="subtitle">
          敌方预览：{enemyCount} 个单位（{enemyPreview.map((e) => e.name).slice(0, 6).join('、')}…）
        </div>

        {/* v2.3 战前布阵：绿色为我方可部署区，红点为敌方开场落点 */}
        <div className="subtitle" style={{ marginTop: 10 }} id="tut-formation">战前布阵：</div>
        <FormationEditor
          arena={plan.arena}
          team={run.team}
          anchor={plan.spawnAlly[0]}
          value={form}
          onChange={setForm}
          preset={preset}
          onPreset={setPreset}
          enemyPreview={enemySpots}
          bossPos={plan.bossPos}
        />

        <div className="subtitle" style={{ marginTop: 8 }}>增益三选一：</div>
        <div className="row">
          {choices.map((c) => (
            <button
              key={c.id}
              className={picked === c.id ? 'primary' : ''}
              onClick={() => setPicked(c.id)}
            >
              <div className="hero-name">{c.name}</div>
              <div className="tag">{c.desc}</div>
            </button>
          ))}
        </div>

        <div id="tut-prebattle-skip" className="row between" style={{ marginTop: 8 }}>
          <span className="tag">当前遗物：{run.relics.length ? run.relics.map((r) => r.name).join('、') : '无'}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="ghost" onClick={() => setScreen('inter')} title="返回综合页面补给装备 / 招募">↩ 返回休整</button>
            {canSkip && (
              <button className="ghost" onClick={skip} title="本层已通关，直接结算为胜利">
                ⏭ 跳过本层
              </button>
            )}
            <button id="tut-prebattle-start" className="primary" disabled={!picked || countdown > 0} onClick={confirm}>
              {countdown > 0 ? COUNTDOWN_LABEL[countdown] : '确认开战'}
            </button>
          </div>
        </div>
      </div>

      {/* v3.2 开战倒计时覆盖层：3,2,1 */}
      {countdown > 0 && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8,
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 800, color: '#ffd76a', animation: 'countdown-pop 1s ease-in-out infinite', textAlign: 'center', padding: '0 20px' }}>
            {COUNTDOWN_LABEL[countdown]}
          </div>
          <div style={{ color: '#bbb', fontSize: 14 }}>即将进入第 {run.layer} 层战斗…</div>
        </div>
      )}

      {/* v2.2 新手模式第 5 层开战前教学浮层（冲刺通关 + 跳过已通关层） */}
      <TutorialOverlay screen="pre" />
    </div>
  );
}
