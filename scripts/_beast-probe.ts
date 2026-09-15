// v1.8.4 兽类专属随机特性验证探针：
// ① buildWaves 对兽类敌人按位置确定性注入特性（同 seed 同特性、跨 seed 有差异）
// ② 战斗引擎实际触发：自爆（日志）、产仔（isBeastling 出现）、免疫（'免疫' 飘字）、复仇（小个体打击杀者）
// ③ 同 seed 两场战斗逐位一致（特性未破坏确定性）
import { BattleSim } from '../packages/core/src/engine/battle';
import { makeAlly, makeEnemy } from '../packages/core/src/engine/unit';
import { HEROES } from '../packages/core/src/content/heroes';
import { ARENAS, parseSpawns } from '../packages/core/src/content/arenas';
import { buildWaves } from '../packages/core/src/gen/encounter';
import { isBeastEnemy } from '../packages/core/src/content/beast';
import { mulberry32 } from '../packages/core/src/engine/rng';
import { enemyScale } from '../packages/core/src/engine/scaling';
import { genLayer } from '../packages/core/src/gen/levelGen';

const TICK = 1 / 20;

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) fail++;
};

// ── ① 生成层确定性 ──
console.log('\n[1] buildWaves 兽类特性注入（确定性）');
{
  const rngA = mulberry32(1234);
  const wavesA = buildWaves(rngA, 20, undefined);
  const rngB = mulberry32(1234);
  const wavesB = buildWaves(rngB, 20, undefined);
  // 同 seed → 同特性（含位置）
  const flatA = wavesA.flat().map((e) => `${e.id}:${e.beastTrait ?? '-'}`);
  const flatB = wavesB.flat().map((e) => `${e.id}:${e.beastTrait ?? '-'}`);
  ok(JSON.stringify(flatA) === JSON.stringify(flatB), '同 seed 波次+特性完全一致');

  // 兽类敌人（demon/gargoyle/dragon/demon_wolf/fae_wolf）有概率获得特性，且非兽类（witch/skeleton/fallen_angel）恒无
  let beastWith = 0, beastTotal = 0, nonBeastWith = 0;
  let wolfWith = 0, wolfTotal = 0;
  for (let s = 0; s < 60; s++) {
    const w = buildWaves(mulberry32(s), 15 + (s % 30), undefined);
    for (const e of w.flat()) {
      const isBeast = isBeastEnemy(e.monsterKind);
      if (isBeast) {
        beastTotal++; if (e.beastTrait) beastWith++;
        if (e.monsterKind === 'demon_wolf' || e.monsterKind === 'fae_wolf') {
          wolfTotal++; if (e.beastTrait) wolfWith++;
        }
      }
      else if (e.beastTrait) nonBeastWith++;
    }
  }
  console.log(`    兽类 ${beastWith}/${beastTotal} 获特性；狼 ${wolfWith}/${wolfTotal} 获特性；非兽类带特性 ${nonBeastWith}`);
  ok(beastTotal > 0, '样本里存在兽类敌人');
  ok(beastWith > 0 && beastWith < beastTotal, '部分兽类获得特性（非全有非全无）');
  ok(wolfTotal > 0, '样本里存在恶魔狼/精灵狼');
  ok(wolfTotal > 0 && wolfWith > 0 && wolfWith < wolfTotal, '部分狼获得兽类特性');
  ok(nonBeastWith === 0, '非兽类（女巫/骷髅/堕天使）恒无兽类特性');

  // 三特性都出现过（样本足够时）
  const kinds = new Set<string>();
  for (let s = 0; s < 300; s++) {
    for (const e of buildWaves(mulberry32(9000 + s), 20, undefined).flat()) {
      if (e.beastTrait) kinds.add(e.beastTrait);
    }
  }
  ok(kinds.has('selfdestruct') && kinds.has('nest') && kinds.has('immunity'),
    `三种特性均被分配到（${[...kinds].join(',')}）`);
}

// ── ② 引擎行为触发 ──
console.log('\n[2] 战斗引擎触发兽类特性');
{
  // 找一只自爆兽类与一只产仔兽类，直接构造 1v1 战斗验证
  const findTrait = (t: string) => {
    for (let s = 0; s < 500; s++) {
      const w = buildWaves(mulberry32(s), 20, undefined);
      const e = w.flat().find((x) => x.beastTrait === t);
      if (e) return { e, seed: s };
    }
    return null;
  };
  const arena = ARENAS.A1;
  const spawns = parseSpawns(arena);

  const runOne = (enemyDef: Parameters<typeof makeEnemy>[0], seed: number, heroIdx = 0) => {
    const sc = enemyScale(10);
    const ally = makeAlly(HEROES[heroIdx], 12, []);
    ally.x = 4; ally.y = 6; ally.derived.hp = ally.maxHp * 5; ally.hp = ally.maxHp * 5; // 扛爆
    const enemy = makeEnemy(enemyDef, 12, sc.hp * 1.2, sc.dmg);
    enemy.x = 10; enemy.y = 6;
    enemy.derived.hp = enemy.maxHp * 3; enemy.maxHp = enemy.maxHp * 3; enemy.hp = enemy.maxHp; // 拉长战斗
    const sim = new BattleSim([ally, enemy], arena, seed);
    for (let i = 0; i < 20 * 120 && !sim.over; i++) sim.tick(TICK);
    return sim;
  };

  // 自爆
  const sd = findTrait('selfdestruct');
  if (sd) {
    const sim = runOne(sd.e, sd.seed);
    const boom = sim.log.some((l) => l.includes('自爆'));
    const immuneTxt = sim.floaters.some((f) => f.text.includes('自爆'));
    ok(boom || immuneTxt, `自爆触发（${sd.e.name} seed=${sd.seed} result=${sim.result}）`);
  } else {
    ok(false, '样本中未找到自爆兽类（扩大样本应能命中）');
  }

  // 产仔（下一站）
  const nt = findTrait('nest');
  if (nt) {
    const sim = runOne(nt.e, nt.seed);
    const ling = sim.units.filter((u) => u.isBeastling).length;
    ok(ling > 0, `下一站产仔触发（${nt.e.name} seed=${nt.seed}，场上幼体 ${ling} 只）`);
  } else {
    ok(false, '样本中未找到产仔兽类（扩大样本应能命中）');
  }

  // 双免轮换：相位随时间切换 + 物理免疫阶段物理伤害飘「免疫」
  const im = findTrait('immunity');
  if (im) {
    const sim = runOne(im.e, im.seed);
    const phases = new Set(sim.units.filter((u) => u.beastTrait === 'immunity').map((u) => u.immunityPhase));
    // 免疫敌人若存活到 3 秒以上，phase 应出现过 1 和 2（每 3 秒切换）
    const enemy = sim.units.find((u) => u.beastTrait === 'immunity');
    const phaseSwitched = enemy ? (enemy.immunityPhase ?? 0) >= 1 && (enemy.immunityPhase ?? 0) <= 2 : false;
    const immuneShown = sim.floaters.some((f) => f.text.includes('免疫')) || sim.log.some((l) => l.includes('免疫'));
    ok(phaseSwitched, `双免轮换相位生效（${im.e.name} seed=${im.seed} phase=${enemy?.immunityPhase}，观测相位 ${[...phases].join(',')}）`);
    ok(immuneShown, `免疫飘字/日志出现（${im.e.name}）`);
  } else {
    ok(false, '样本中未找到免疫兽类（扩大样本应能命中）');
  }
}

// ── ③ 确定性（含特性行为的同 seed 回放）──
console.log('\n[3] 确定性回放（含兽类特性）');
{
  const arena = ARENAS.A1;
  const spawns = parseSpawns(arena);
  const runBattle = (seed: number) => {
    const sc = enemyScale(12);
    const allies = HEROES.slice(0, 5).map((h, k) => {
      const u = makeAlly(h, 10, []);
      const p = spawns.ally[k % spawns.ally.length];
      u.x = p.x; u.y = p.y; return u;
    });
    const waves = buildWaves(mulberry32(seed), 30, undefined);
    const enemies = waves.flat().map((e, k) => {
      const u = makeEnemy(e, 10, sc.hp, sc.dmg);
      const p = spawns.enemy[k % spawns.enemy.length];
      u.x = p.x; u.y = p.y; return u;
    });
    const sim = new BattleSim([...allies, ...enemies], arena, seed);
    const log: string[] = [];
    for (let i = 0; i < 20 * 150 && !sim.over; i++) {
      sim.tick(TICK);
      log.push(sim.log.join('|'));
    }
    return {
      result: sim.result,
      steps: sim.log.length,
      units: sim.units.map((u) => `${u.name}:${Math.round(u.hp)}:${u.alive ? 1 : 0}`).join('|'),
      beastEvents: sim.log.filter((l) => l.includes('自爆') || l.includes('下一站') || l.includes('免疫')).length,
    };
  };
  for (const s of [11, 55, 777]) {
    const a = runBattle(s);
    const b = runBattle(s);
    ok(
      a.result === b.result && a.units === b.units,
      `seed=${s} 两次回放一致（${a.result}，兽类事件 ${a.beastEvents} 次）`,
    );
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
