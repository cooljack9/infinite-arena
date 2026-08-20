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
import TutorialOverlay from './TutorialOverlay';
import HelpButton from '../components/HelpButton';
import MechanismHelp from '../components/MechanismHelp';
import { preloadBattleSim, clearBattlePreload } from '../game/battleBuild';
import { getBackend } from '../backend/index';
import { isRemoteMode, genIdemKey } from '../backend/storeBridge';
import { CORE_VERSION } from '@arena/core/contract';

// v2.10 高阶机制「?」说明文案（全模式可用，UX-5）；anchorId 与 tutorial.ts 教学锚点一致
const MECH_HELP: Record<string, { title: string; text: string }> = {
  vacuum: { title: '真空期', text: '每 10 层的特殊层：敌人变弱、出手更快。是抢节奏、攒优势的好时机——趁现在多补输出。' },
  mutation: { title: '突变层', text: '每 10 层的特殊层：敌人按右侧规则被强化。看清规则再布阵，针对性克制往往能反败为胜。' },
  relic: { title: '当前遗物', text: '遗物是战前永久生效的增益，越攒越强；进入战斗自动套用，无需手动操作。' },
  talent: { title: '增益三选一', text: '每场战前从三张增益里选一张（复用遗物池）：加生命 / 物伤 / 法伤 / 闪避……按当前阵容短板挑。' },
  event: { title: '随机奇遇', text: '战前抉择事件，二选一常有取舍（换强敌换多奖励）。点你想要的即可，结算是确定性的，不会吞掉你的点击。' },
};

export default function PreBattle() {
  const run = useGame((s) => s.run)!;
  const equipped = useGame((s) => s.equipped);
  const battleRemote = useGame((s) => s.battleRemote);
  const addRelic = useGame((s) => s.addRelic);
  const setScreen = useGame((s) => s.setScreen);
  const savedFormation = useGame((s) => s.formation);
  const setFormation = useGame((s) => s.setFormation);
  const formationPreset = useGame((s) => s.formationPreset);
  const resolvedEvents = useGame((s) => s.resolvedEvents);
  const resolveRandomEvent = useGame((s) => s.resolveRandomEvent);
  const seenArenaHints = useGame((s) => s.seenArenaHints);
  const markArenaSeen = useGame((s) => s.markArenaSeen);
  const gold = useGame((s) => s.gold);
  const inventory = useGame((s) => s.inventory);
  // v1.8 布阵上下文：下五层 = 生效层 run.layer+5、敌强 ×1.20、高奖 +10%
  const battleCtx = useGame((s) => s.battleCtx);

  // v1.8：下五层挑战按生效层出图（敌人是「五层后」的强度，再叠 +20%）
  const effLayer = battleCtx.mode === 'skip5' ? run.layer + 5 : run.layer;
  const plan = useMemo(() => genLayer(effLayer, run.seed, run.mode), [effLayer, run.seed, run.mode]);
  const choices = useMemo(() => {
    const rng = mulberry32((run.seed + run.layer * 31) >>> 0);
    return shuffle(rng, PRE_BATTLE_POOL).slice(0, 3);
  }, [run.seed, run.layer]);
  const [picked, setPicked] = useState<string | null>(null);
  // v2.10 当前打开的「?」说明
  const [help, setHelp] = useState<{ anchorId: string; title: string; text: string } | null>(null);

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
  // v1.5 进入布阵页先清掉上一场残留预载，避免跨层吃到旧 sim
  useEffect(() => { clearBattlePreload(); }, []);
  // v1.7 开战两段过场：正在赶往战场 → 准备战斗！（总时长 ~1.2s，引擎已在传参时预载到位）
  const [countdown, setCountdown] = useState(0);
  const COUNTDOWN_LABEL = ['', '准备战斗！', '正在赶往战场'] as const; // index = countdown

  // 与 BattleScreen 调用同一个纯函数，保证预览红点 = 实际开场落点
  const enemySpots = useMemo(
    () => enemyPlacements(plan.arena, plan.spawnEnemy, plan.bossPos, enemyPreview),
    [plan, enemyPreview],
  );

  const confirm = () => {
    if (picked) addRelic(RELIC_BY_ID[picked]);
    setFormation(form, preset);
    if (countdown > 0) return; // 已在过场
    // v1.5 传参完成即后台预载战斗引擎：倒计时两句话播完时 sim 已就绪，BattleScreen 直接开打（无加载门）
    // v1.8：下五层按 battleCtx 传敌强倍率（生效层 + 1.20）；自动爬塔不进本页
    const mods = battleCtx.mode === 'skip5'
      ? { effLayer: run.layer + 5, enemyHpMult: 1.2, enemyDmgMult: 1.2 }
      : undefined;
    requestAnimationFrame(() => preloadBattleSim(run, plan, equipped, form, battleRemote, mods));
    // v1.8.2 云端模式：布阵完成即发 startBattle，1.25s 过场动画期间后端并行算完整局，
    // BattleScreen 挂载直接消费 prefetchBattle → 不再有「⚔ 正在进入战场…」黑屏。
    // 与 BattleScreen.fetchBattle 同参（含 skip5 battleOpts），幂等 key 复用，后端不重复结算。
    if (isRemoteMode() && run.runId) {
      const key = genIdemKey();
      void getBackend().startBattle({
        runId: run.runId,
        idempotencyKey: key,
        coreVersion: CORE_VERSION,
        formation: useGame.getState().formation,
        clientTs: Date.now(),
        battleOpts: mods,
      }).then((r) => {
        if (r.ok) {
          useGame.getState().setPrefetchBattle({ data: r.data, key, mode: battleCtx.mode, runLayer: run.layer });
        } else {
          console.warn('[arena] 布阵预热失败:', r.code, r.message, '（进战后 fetchBattle 兜底）');
        }
      }).catch((e) => console.warn('[arena] 布阵预热异常（进战后 fetchBattle 兜底）:', e));
    }
    // vX 开战弹字动画（倒计时）开始即预载 BattleScreen 组件 chunk：与上方 sim 预载 / 云端 startBattle 并行，
    // 1.25s 动画期间 chunk 下载完成；动画结束 screen 翻转时 React.lazy 直读缓存 → 不再有 Suspense「加载中…」兜底闪现。
    void import('./BattleScreen');
    // 两段过场进战斗（状态驱动，见下方 useEffect）：期间 BattleScreen 挂载即发 startBattle
    setCountdown(2);
  };

  // v1.7 两段过场状态机：countdown 2→1→0，0 时切 battle；组件卸载自动清理定时器
  useEffect(() => {
    if (countdown === 0) return;
    const t = setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else { setCountdown(0); setScreen('battle'); }
    }, 600); // v1.7 开战过场总时长 ~1.2s（2×600ms ≈ 1.25s 上限）：两句话播完即进战斗，引擎已预载到位
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // v2.0 跳过已通关层：v1.8 移除（跳过本层有悖于游戏根本，玩家必须真打真赢）。
  // 相关教学锚点 tut-prebattle-skip 已从 tutorial.ts / integration.ts 移除。

  return (
    <div className="app">
      <div className="panel col">
        <div className="title" style={{ fontSize: 18 }}>
          {battleCtx.mode === 'skip5'
            ? `第 ${run.layer} 层 · 下五层挑战（敌方=第 ${effLayer} 层 ×1.20）· ${plan.arena.name}`
            : `第 ${run.layer} 层 · ${plan.arena.name}`}
        </div>
        {battleCtx.mode === 'skip5' && (
          <div className="row" style={{ gap: 6 }}>
            <span className="chip" style={{ color: '#ffd76a', borderColor: '#c9a33f' }}>🟡 下五层：一场顶五层 · 高奖 +10%</span>
          </div>
        )}
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
          {plan.isVacuum && (
            <span className="row" style={{ gap: 4, alignItems: 'center' }}>
              <span id="tut-prebattle-vacuum" className="chip" style={{ color: '#ffcc4d' }}>⚠ 真空期：敌弱速快</span>
              <HelpButton label="真空期说明" onClick={() => setHelp({ anchorId: 'tut-prebattle-vacuum', ...MECH_HELP.vacuum })} />
            </span>
          )}
          {plan.isMutation && (
            <span className="row" style={{ gap: 4, alignItems: 'center' }}>
              <span id="tut-prebattle-mutation" className="chip" style={{ color: '#ff4a4a' }}>突变层：{plan.mutationRule}</span>
              <HelpButton label="突变层说明" onClick={() => setHelp({ anchorId: 'tut-prebattle-mutation', ...MECH_HELP.mutation })} />
            </span>
          )}
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
              id="tut-prebattle-event"
              style={{
                marginTop: 8,
                padding: '10px 12px',
                border: '1px solid #6a4ad0',
                borderRadius: 8,
                background: 'rgba(106, 74, 208, 0.10)',
              }}
            >
              <div className="subtitle" style={{ marginTop: 0, color: '#c9b6ff', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
                ⚡ 奇遇事件：{ev.title}
                <HelpButton label="随机奇遇说明" onClick={() => setHelp({ anchorId: 'tut-prebattle-event', ...MECH_HELP.event })} />
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

        <div className="subtitle" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }} id="tut-prebattle-talent">
          增益三选一：
          <HelpButton label="增益三选一说明" onClick={() => setHelp({ anchorId: 'tut-prebattle-talent', ...MECH_HELP.talent })} />
        </div>
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

        <div id="tut-prebattle-skip" className="col" style={{ marginTop: 8, gap: 6 }}>
          <div className="row between">
            <span className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span id="tut-prebattle-relic" className="tag">当前遗物：{run.relics.length ? run.relics.map((r) => r.name).join('、') : '无'}</span>
              <HelpButton label="遗物说明" onClick={() => setHelp({ anchorId: 'tut-prebattle-relic', ...MECH_HELP.relic })} />
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button className="ghost" onClick={() => setScreen('inter')} title="返回综合页面补给装备 / 招募">↩ 返回休整</button>
              <button id="tut-prebattle-start" className="primary" disabled={!picked || countdown > 0} onClick={confirm}>
                {countdown > 0 ? COUNTDOWN_LABEL[countdown] : '确认开战'}
              </button>
            </div>
          </div>
          {/* v3.3 开战按钮禁用时显式告知原因，避免玩家困惑（UX-2） */}
          {!picked && countdown === 0 && (
            <div className="muted" style={{ fontSize: 12, color: '#ffb37a', textAlign: 'right' }}>
              ⚠ 请先在上方「增益三选一」中点选一张增益，才能开战
            </div>
          )}
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

      {/* v2.10 高阶机制「?」说明（全模式可用，UX-5） */}
      {help && (
        <MechanismHelp
          anchorId={help.anchorId}
          title={help.title}
          text={help.text}
          onClose={() => setHelp(null)}
        />
      )}

      {/* v2.2 新手模式第 10 层开战前教学浮层（冲刺通关 + 高阶机制） */}
      <TutorialOverlay screen="pre" />
    </div>
  );
}
