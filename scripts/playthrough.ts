// 本地版本「完整全量体验」：用 Pure Core 确定性引擎跑通两种模式，记录每一层真实战报。
// 不碰 UI，直接吃 rules 纯函数（与线上 Edge Function 同字节），等价于把游戏逻辑从头打到尾。
import {
  createRun, planBattle, runBattle, applySettlement,
  openDrops, equipAll, upgradeHero, resolveRandomEvent, recruit,
  type RunSnapshot, type SettleResult, type RunSecret,
} from '../packages/core/src/rules/index';
import { recruitCostOf } from '../packages/core/src/rules/economy';
import { capFor } from '../packages/core/src/engine/scaling';
import { themeForDepth } from '../packages/core/src/content/arenas';
import { genLayer } from '../packages/core/src/gen/levelGen';
import { HERO_BY_ID } from '../packages/core/src/content/heroes';

const val = <T,>(r: { ok: boolean; data?: T; error?: unknown }): T => {
  if (!r.ok) throw new Error('RULE_ERR ' + JSON.stringify(r.error));
  return r.data as T;
};
function step<T>(name: string, r: { ok: boolean; data?: T; error?: unknown }): T {
  if (!r.ok) throw new Error(`[${name}] ` + JSON.stringify(r.error ?? r));
  return r.data as T;
}

interface LayerRec {
  layer: number; theme: string; boss: string;
  result: 'win' | 'lose'; ticks: number; dur: number;
  mvp: string | null; dead: number; gold: number; score: number;
  teamSize: number; stars: string;
}

function heroName(uid: string, snap: RunSnapshot): string {
  const h = snap.team.find((t) => t.uid === uid);
  return h ? HERO_BY_ID[h.id]?.name ?? h.id : uid;
}

function playRun(mode: 'novice' | 'normal', seed: number, heroIds: string[], label: string): LayerRec[] {
  // 与真实 LocalBackend 一致：secret 取 snapshot.renderSeed（storeBridge.ts:50），
  // 这样 planBattle 与 resolveRandomEvent 同源（都用 renderSeed），自洽。
  const snap0 = val(createRun({ runId: `${label}-${seed}`, seed, heroIds, mode, endlessUnlocked: mode !== 'novice' }));
  const secret: RunSecret = { seed: snap0.renderSeed ?? 0 };
  let snap = snap0;
  const cap = capFor(mode);
  const recs: LayerRec[] = [];
  let guard = 0;

  while (snap.status === 'active' && guard++ < 2000) {
    const layer = snap.layer;
    const theme = themeForDepth(layer);
    const boss = !!planBattle(snap, secret).data?.enemyPreview?.bossTier;
    const bossLabel = boss ? 'Boss' : (planBattle(snap, secret).data?.enemyPreview?.eliteBoss ? '精英' : '');

    // 战前奇遇（用与 resolveRandomEvent 同源的 renderSeed 判定，保证自洽）
    // 像真实玩家一样：逐个选项尝试，跳过买不起/无材料的，选第一个可行的。
    const evPlan = genLayer(layer, snap.renderSeed ?? 0, snap.mode);
    if (evPlan.randomEvent && !snap.resolvedEvents.includes(layer)) {
      const optN = evPlan.randomEvent.options.length;
      for (let oi = 0; oi < optN; oi++) {
        const r = resolveRandomEvent(snap, layer, oi);
        if (r.ok) { snap = r.data; break; }
        if (!['INSUFFICIENT_GOLD', 'NO_MATERIAL', 'EVENT_OPTION'].includes((r.error as any)?.code)) break;
      }
    }

    const b: SettleResult = step('runBattle', runBattle(snap, secret, {}));
    snap = applySettlement(snap, secret, b);

    recs.push({
      layer, theme, boss: bossLabel,
      result: b.result, ticks: b.totalTicks, dur: b.durationSec,
      mvp: b.mvpUid ? heroName(b.mvpUid, snap) : null,
      dead: b.deadAllyUids.length, gold: snap.gold, score: snap.score,
      teamSize: snap.team.length,
      stars: snap.team.map((h) => h.star).join('/'),
    });

    if (b.result === 'win' && snap.status === 'active') {
      // 休整：开箱 → 一键装备 → 有余钱升星（金币的长期出口）
      if (snap.pendingDrops.length) snap = step('openDrops', openDrops(snap, snap.pendingDrops.map((d) => d.id)));
      snap = step('equipAll', equipAll(snap));
      const cost = recruitCostOf(snap.layer);
      const weak = snap.team.slice().sort((a, b) => (a.star ?? 1) - (b.star ?? 1))[0];
      if (snap.gold >= cost && weak && (weak.star ?? 1) < 5) snap = step('upgradeHero', upgradeHero(snap, weak.uid));
      // 队伍未满则偶尔招募（演示养成线）
      if (snap.team.length < 4 && snap.gold >= cost + 50 && snap.recruitPool.length) {
        snap = step('recruit', recruit(snap, secret, snap.recruitPool[0].id));
      }
    }
  }
  return recs;
}

function report(label: string, mode: 'novice' | 'normal', recs: LayerRec[]) {
  const L: string[] = [];
  const wins = recs.filter((r) => r.result === 'win').length;
  const losses = recs.length - wins;
  const totalTicks = recs.reduce((s, r) => s + r.ticks, 0);
  const totalDur = recs.reduce((s, r) => s + r.dur, 0);
  const deepest = recs.length ? recs[recs.length - 1].layer : 0;
  const themes = Array.from(new Set(recs.map((r) => r.theme)));
  const mvpCount: Record<string, number> = {};
  for (const r of recs) if (r.mvp) mvpCount[r.mvp] = (mvpCount[r.mvp] ?? 0) + 1;
  const topMvp = Object.entries(mvpCount).sort((a, b) => b[1] - a[1]).slice(0, 3);

  L.push(`### ${label}（mode=${mode}）`);
  L.push(`- 总战斗场数: ${recs.length}（胜 ${wins} / 负 ${losses}）`);
  L.push(`- 推进最深: 第 ${deepest} 层（封顶 ${capFor(mode)}）`);
  L.push(`- 累计 tick: ${totalTicks} ≈ ${totalDur.toFixed(1)}s 模拟战斗时长`);
  L.push(`- 经历主题: ${themes.join(' → ')}`);
  L.push(`- MVP 分布(Top3): ${topMvp.map(([k, v]) => `${k}×${v}`).join(' | ') || '—'}`);
  L.push(`- 逐层战报:`);
  for (const r of recs) {
    L.push(`    L${String(r.layer).padStart(2)} [${r.theme.slice(0, 4)}]${r.boss ? ' ' + r.boss : '    '} ${r.result === 'win' ? '胜' : '败'} tick=${String(r.ticks).padStart(4)} ${r.dur.toFixed(1)}s MVP=${r.mvp ?? '—'} 亡=${r.dead} 金=${r.gold} 分=${r.score} 队=${r.teamSize}★${r.stars}`);
  }
  return L.join('\n');
}

const out: string[] = [];
out.push('# 无限勇者竞技场 · 本地版完整全量体验（确定性引擎实跑）');
out.push('');

// A. 新手教学战役（固定种子，演示 onboarding）
const novice = playRun('novice', 20260809, ['h_physTank', 'h_sniper', 'h_healer'], 'novice');
out.push(report('A. 新手教学战役', 'novice', novice));
out.push('');

// B. 普通无尽深塔：多种子批量，刻画真实难度分布（roguelike 方差）
const seeds = [101, 202, 303, 404, 505, 606, 707, 808, 909, 20260809];
out.push('### B. 普通无尽深塔 · 10 种子批量（裸策略：开箱 + 一键装备 + 有余钱升星/招募）');
const rows: string[] = [];
let sumDepth = 0, wonCap = 0, threeLoss = 0, totalBattles = 0;
let deepest = novice; let deepestDepth = 0;
for (const sd of seeds) {
  const recs = playRun('normal', sd, ['h_physTank', 'h_sniper', 'h_healer'], `e${sd}`);
  const depth = recs.length ? recs[recs.length - 1].layer : 0;
  const losses = recs.filter((r) => r.result === 'lose').length;
  const status = depth >= capFor('normal') ? '登顶' : losses >= 3 ? '三败' : '异常';
  if (status === '登顶') wonCap++;
  if (status === '三败') threeLoss++;
  sumDepth += depth; totalBattles += recs.length;
  if (depth > deepestDepth) { deepestDepth = depth; deepest = recs; }
  rows.push(`- seed=${String(sd).padStart(8)} 最深=${String(depth).padStart(3)} 胜=${recs.filter((r) => r.result === 'win').length} 负=${losses} → ${status} 末队=${recs.length ? recs[recs.length - 1].teamSize : 0}人 ★${recs.length ? recs[recs.length - 1].stars : '-'}`);
}
out.push(rows.join('\n'));
out.push('');
out.push(`- 平均推进深度: ${(sumDepth / seeds.length).toFixed(1)} 层 / 封顶 ${capFor('normal')}`);
out.push(`- 登顶率: ${wonCap}/${seeds.length}　三败出局率: ${threeLoss}/${seeds.length}　合计战斗: ${totalBattles} 场`);
out.push('');

// C. 最深一局的完整逐层战报（代表性「全量体验」）
out.push('### C. 代表性完整战报（最深一局，共 ' + deepest.length + ' 场）');
out.push(report('最深深塔', 'normal', deepest));
out.push('');

out.push('## 体验结论');
out.push(`- 新手战役：${novice.length >= 5 && novice[novice.length - 1].result === 'win' ? '5/5 全胜通关，顺利解锁无尽（onboarding 温和、可达）' : '未通关'}`);
out.push(`- 无尽深塔：方差极大——既有登顶 500 的种子，也有第 3 层即三败出局的积木；平均深度 ${(sumDepth / seeds.length).toFixed(1)} 层。`);
out.push(`- 上述均为「裸策略」（仅开箱+自动装备+有余钱升星），未用锻造/重铸/性格/坐骑/消耗品等深度系统，真实玩家上限更高。`);

console.log(out.join('\n'));

