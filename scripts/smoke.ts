// v1.6 战斗引擎冒烟测试（trust-but-verify）：本次改动面很大——
// 伤害/死亡链路重写 + 9 个特性钩子 + 9 个技能二段。这里验证三件事：
//   1) 不崩、能分出胜负
//   2) 同 seed 完全可复现（确定性没被特性钩子破坏）
//   3) 特性确实在跑（日志/状态里能观测到）
import { BattleSim } from '../packages/core/src/engine/battle';
import { makeAlly, makeEnemy, displayName } from '../packages/core/src/engine/unit';
import { HEROES } from '../packages/core/src/content/heroes';
import { ENEMIES } from '../packages/core/src/content/enemies';
import { ARENAS, parseSpawns } from '../packages/core/src/content/arenas';
import { buildWaves } from '../packages/core/src/gen/encounter';
import { mulberry32 } from '../packages/core/src/engine/rng';
import { enemyScale } from '../packages/core/src/engine/scaling';
import { variateHero } from '../packages/core/src/content/variant';
import { PERSONALITIES, PERSONALITY_IDS, rollPersonality } from '../packages/core/src/content/personalities';
import { skillPowerMult, skillStarCdr } from '../packages/core/src/content/classes';
import { TraitId, PersonalityId, HeroDef } from '../packages/core/src/types';

const TICK = 1 / 20;

function runOnce(seed: number, heroIdx: number[], layer: number) {
  const arena = ARENAS.A1;
  const spawns = parseSpawns(arena);
  const rng = mulberry32(seed);
  const sc = enemyScale(layer);

  const allies = heroIdx.map((i, k) => {
    const u = makeAlly(HEROES[i], 5 + layer, []);
    const p = spawns.ally[k % spawns.ally.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  const waves = buildWaves(rng, layer, false);
  const enemies = waves[0].map((e, k) => {
    const u = makeEnemy(e, 5 + layer, sc.hp, sc.dmg);
    const p = spawns.enemy[k % spawns.enemy.length];
    u.x = p.x; u.y = p.y;
    return u;
  });

  const sim = new BattleSim([...allies, ...enemies], arena, seed);
  let steps = 0;
  // v2.9.8：奶妈改为「轻击/重击都治疗队友」后，需要观测两个新指标——
  //   summonAtFirstTick：女娲开局是否立刻造化（① 开局立即释放大招）
  //   heal：我方累计治疗量（③ 奶妈普攻转治疗是否真的在奶）
  let summonAtFirstTick = 0;
  let minAllyPct = 1;
  while (!sim.over && steps < 20 * 120) {
    sim.tick(TICK);
    steps++;
    if (steps === 1) summonAtFirstTick = sim.units.filter((u) => u.alive && u.isSummon && u.side === 'ally').length;
    for (const a of sim.units) {
      if (a.side !== 'ally' || a.isSummon || a.isBuilding || !a.alive) continue;
      minAllyPct = Math.min(minAllyPct, a.hp / a.maxHp);
    }
  }
  return {
    result: sim.result,
    steps,
    log: sim.log.slice(),
    hp: sim.units.map((u) => `${u.name}:${Math.round(u.hp)}`).join('|'),
    summonAtFirstTick,
    minAllyPct,
    heal: sim.units.filter((u) => u.side === 'ally').reduce((a, u) => a + (u.healDone ?? 0), 0),
    // 注意字段名是 dmgDealt（types.ts:387）。v2.9.8 这里误写成 dmgDone，
    // 恒为 undefined→0，导致「零伤害」断言空过——一条永远为真的假阳性测试。
    healerDmg: sim.units
      .filter((u) => u.side === 'ally' && u.subclass === 'healer')
      .reduce((a, u) => a + (u.dmgDealt ?? 0), 0),
    allyDmg: sim.units
      .filter((u) => u.side === 'ally')
      .reduce((a, u) => a + (u.dmgDealt ?? 0), 0),
  };
}

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) fail++;
};

// ── 1. 全职业组合都能跑完 ──
console.log('\n[1] 战斗可完成性（9 个职业轮转 12 组）');
let decided = 0;
for (let s = 0; s < 12; s++) {
  const idx = [s % 9, (s + 3) % 9, (s + 6) % 9];
  const r = runOnce(1000 + s, idx, 1 + (s % 5));
  if (r.result) decided++;
  else console.log(`    seed=${1000 + s} 未分胜负（${r.steps} 步）`);
}
ok(decided >= 11, `12 组中 ${decided} 组正常分出胜负`);

// ── 2. 确定性（同 seed 必须逐字节一致）──
console.log('\n[2] 确定性回放');
for (const s of [7, 42, 99]) {
  const a = runOnce(s, [0, 4, 8], 3);
  const b = runOnce(s, [0, 4, 8], 3);
  ok(
    a.result === b.result && a.steps === b.steps && a.hp === b.hp,
    `seed=${s} 两次回放一致（${a.result}, ${a.steps} 步）`,
  );
}

// ── 3. 特性实际生效 ──
console.log('\n[3] 特性运行时可观测');
const traitOf: Record<number, TraitId | undefined> = {};
HEROES.forEach((h, i) => { traitOf[i] = h.traitId; });
console.log('    英雄→特性:', HEROES.map((h) => `${h.name}=${h.traitId ?? '无'}`).join(', '));
ok(HEROES.every((h) => !!h.traitId), '9 个英雄全部绑定了特性');

// 魔刃（hexblade）+ 禁锢（controller）+ 军团（summoner）跑满 20 局，收集日志关键词
const hits = { 魔刃: 0, 禁锢: 0, 强化: 0, 震荡: 0, 定身: 0, 破阵: 0, 背水: 0 };
for (let s = 0; s < 20; s++) {
  const r = runOnce(500 + s, [3, 6, 7], 2 + (s % 6));
  for (const line of r.log) {
    for (const k of Object.keys(hits) as (keyof typeof hits)[]) {
      if (line.includes(k)) hits[k]++;
    }
  }
}
console.log('    日志命中:', JSON.stringify(hits));
ok(hits.魔刃 + hits.禁锢 + hits.强化 > 0, '特性/二段机制在实战日志中被触发');

// 坦克组：验证坚壁护盾与嘲讽震荡
// v2.9.8 注意：第三位由华佗(8) 换成神机炮手(4)。原因是本版奶妈改成「轻击/重击都治疗队友」，
// 华佗会把队伍血线长期托在 85% 以上，而嘲讽二段的施放门槛是「有队友低于 60% 血」——
// 带奶阵容里该门槛几乎永不成立，等于用一个特性把另一个特性的测试覆盖掉了。
// 压测嘲讽机制本身，应当用无治疗阵容；奶妈的正向覆盖单独放在下面一组。
const hits2 = { 坚壁: 0, 震荡: 0 };
for (let s = 0; s < 20; s++) {
  const r = runOnce(800 + s, [0, 1, 4], 2 + (s % 6));
  for (const line of r.log) {
    if (line.includes('震荡')) hits2.震荡++;
    if (line.includes('坚壁')) hits2.坚壁++;
  }
}
console.log('    坦克组日志:', JSON.stringify(hits2));
ok(hits2.震荡 > 0, '嘲讽二段（震荡波）被触发');

// ── 4. v2.9.8 新增特性覆盖 ──
console.log('\n[4] v2.9.8 新增机制');

// ① 女娲开局立即造化：第一个 tick 结束时场上就该有召唤物
let openingSummon = 0;
let recast = 0;
for (let s = 0; s < 20; s++) {
  const r = runOnce(900 + s, [7, 2, 6], 2 + (s % 6));
  if (r.summonAtFirstTick > 0) openingSummon++;
  for (const line of r.log) if (line.includes('造化重铸')) recast++;
}
console.log(`    女娲组：开局即召唤 ${openingSummon}/20，击杀重铸 ${recast} 次`);
ok(openingSummon === 20, '女娲开局立即释放大招（首 tick 已有召唤物）');
ok(recast > 0, '女娲/召唤物击杀敌人后自动重铸大招');

// ③ v2.9.9 治疗职业「重击转群疗」（需求：重击和大招回血，普攻还是弱普攻）。
// v2.9.8 的教训：那版把轻击也改成治疗，血线常驻 85%+，嘲讽二段等低血触发机制全废。
// 现在只有「重击」这一拍转群疗（节奏定档：每 3 拍 1 轮 ×2 连，开场首拍即群疗）。
// 五条正交断言，各锁一个设计意图：
//    a) 每局都能观测到群疗事件 —— 机制不是"看运气才出现"（≥18/20，剩余为治疗者早亡的局）
//    b) 掉血局绝大多数产出实际回血 —— 少数是恩泽把溢疗全转成了护盾（healDone 不计护盾）
//    c) 治疗职业普攻仍打敌人（伤害 > 0）—— 她不再是站桩泵
//    d) 她的伤害占全队 < 15% —— 弱普攻真的弱，没抢输出位（用标准输出阵容量，双坦阵容
//       里坦克本身没输出，占比会被抬到 ~19%，那是阵容伪影不是平衡问题）
//    e) 20 局里至少有 1 局血线跌破 60% —— 低血触发机制重新有效
let damagedRuns = 0;
let healedRuns = 0;
let healTotal = 0;
let lowHpRuns = 0;
let burstRuns = 0;
for (let s = 0; s < 20; s++) {
  const r = runOnce(800 + s, [0, 1, 8], 2 + (s % 6));
  if (r.minAllyPct < 0.999) {
    damagedRuns++;
    if (r.heal > 0) healedRuns++;
  }
  if (r.minAllyPct < 0.6) lowHpRuns++;
  if (r.log.some((l) => l.includes('回春重击'))) burstRuns++;
  healTotal += r.heal;
}
// 输出占比单独用「武圣+炮手+治疗」这套有真实 DPS 的标准阵容量
let healerDmgTotal = 0;
let allyDmgTotal = 0;
for (let s = 0; s < 20; s++) {
  const r = runOnce(800 + s, [2, 4, 8], 2 + (s % 6));
  healerDmgTotal += r.healerDmg;
  allyDmgTotal += r.allyDmg;
}
const healerShare = allyDmgTotal > 0 ? healerDmgTotal / allyDmgTotal : 0;
console.log(
  `    治疗组：群疗局 ${burstRuns}/20；掉血局 ${damagedRuns}/有实际回血 ${healedRuns}；` +
  `均治疗量 ${Math.round(healTotal / 20)}；血线跌破 60% 的局 ${lowHpRuns}/20；` +
  `标准阵容伤害占比 ${(healerShare * 100).toFixed(1)}%`,
);
ok(burstRuns >= 18, '重击转群疗每局稳定触发（≥18/20）');
ok(damagedRuns > 0 && healedRuns >= Math.ceil(damagedRuns * 0.85), '掉血局绝大多数产出实际回血（余量为溢疗转盾）');
ok(healerDmgTotal > 0, '治疗职业轻击仍打敌人（弱普攻未被砍成 0）');
ok(healerShare < 0.15, '治疗职业伤害占全队 < 15%（弱普攻不抢输出位）');
ok(lowHpRuns > 0, '治疗不再把血线钉死在高位（低血触发机制仍可生效）');

// ── 5. v3.1 六项修复的长期守卫 ──
// 这一组全部是**受控探针**（1v1 / 定点摆位），不靠"跑 20 局看日志有没有出现关键词"。
// 关键词式断言只能证明"代码路径被走到过"，证明不了"算出来的数对不对"——
// 本次要修的第 1 条（必爆被写成了翻倍）恰恰是路径走到了、数值算错了。
console.log('\n[5] v3.1 六项修复');

const enemyDef = (id: string) => {
  const d = ENEMIES.find((e) => e.id === id);
  if (!d) throw new Error(`smoke: 找不到敌人模板 ${id}`);
  return d;
};
/** 取本 tick 新出现的伤害飘字（技能名横幅等非数字飘字会被过滤掉） */
const firstDamage = (sim: BattleSim) => {
  const f = sim.floaters.find((x) => /^~?\d+$/.test(x.text));
  return f ? Number(f.text.replace('~', '')) : 0;
};

/**
 * 贯日神射「二段」受控探针。
 * 把射手的普攻 cd 顶到天上（本局只剩技能这一条伤害来源）、暴击率清零（排除随机暴击），
 * 木桩 scaleDmg=0 不还手，于是首个伤害飘字必然就是二段的那一发。
 *   · hpFrac=1.00 → 过 >50% 血门槛 → 必定暴击 → 400% × 爆伤
 *   · hpFrac=0.45 → 不过门槛；又高于致命特性的 40% 线 → 400%，无任何额外乘区
 * 两者之比 = 纯爆伤倍率。旧 bug（×2 伤害 + 强制暴击）会让这个比值整整翻一倍。
 */
function deadshotProbe(hpFrac: number, star = 1): number {
  const arena = ARENAS.A1;
  const me = makeAlly({ ...HEROES[5], star }, 10, []); // 贯日神射
  me.x = 4; me.y = 6;
  me.derived.crit = 0; // 排除随机暴击噪声
  me.cd = 1e9;         // 冻结普攻
  const dummy = makeEnemy(enemyDef('e_physTank_a'), 10, 400, 0);
  dummy.x = 10; dummy.y = 6; // 距离 6 < 射程 6.5：站定即可施法，全程零位移
  dummy.hp = Math.max(1, Math.round(dummy.maxHp * hpFrac));
  dummy.derived.dodge = 0;
  dummy.cd = 1e9;
  dummy.skillCd = 1e9;
  const sim = new BattleSim([me, dummy], arena, 1);
  for (let i = 0; i < 20 * 20; i++) { // 上限 20s：必须早于 30s 终局爆伤衰减
    sim.tick(TICK);
    const d = firstDamage(sim);
    if (d > 0) return d;
  }
  return 0;
}

const dsHigh = deadshotProbe(1.00);
const dsLow = deadshotProbe(0.45);
const critMult = makeAlly(HEROES[5], 10, []).derived.critDmg / 100;
const dsRatio = dsLow > 0 ? dsHigh / dsLow : 0;
console.log(
  `    ① 贯日神射：满血目标 ${dsHigh} / 45% 血目标 ${dsLow} = ${dsRatio.toFixed(3)}；` +
  `爆伤倍率 ${critMult.toFixed(3)}`,
);
ok(dsHigh > 0 && dsLow > 0, '二段在两种血线下都结算出了伤害');
ok(Math.abs(dsRatio - critMult) < 0.02, '二段对 >50% 血目标是「必定暴击」（比值 = 爆伤倍率）');
ok(dsRatio < critMult * 1.5, '二段没有额外的「伤害翻倍」乘区（旧 bug 会让比值再 ×2）');

// ② 升星强化技能：技能等级 = 星级，效果 +18%/星、CD −4%/星。
// 既查静态字段，也用同一支探针实测「5★ 的技能伤害 = 1★ 的 1.72 倍」——
// 光查字段只能证明算出来了，证明不了它真的被乘进了伤害。
const star1 = makeAlly({ ...HEROES[5], star: 1 }, 10, []);
const star5 = makeAlly({ ...HEROES[5], star: 5 }, 10, []);
const ds1 = deadshotProbe(0.45, 1);
const ds5 = deadshotProbe(0.45, 5);
// 关键：升星同时抬高「一级属性」和「技能等级」两件事。直接看 ds5/ds1 会把
// 属性成长（starMult → pDmg）也算进来，读出 3.98 这种数——那不是 bug，是量错了。
// 签名技伤害 = pDmg × 400% × skillPower，所以要先把 pDmg 的涨幅除掉，
// 剩下的残差才是「技能等级」这一层的真实贡献。
const atkGain = star5.derived.pDmg / star1.derived.pDmg;
const starRatio = ds1 > 0 ? ds5 / ds1 : 0;
const skillGain = atkGain > 0 ? starRatio / atkGain : 0;
console.log(
  `    ② 升星：skillPower 1★=${star1.skillPower} 5★=${star5.skillPower}；skillCdr 5★=${star5.skillCdr}；` +
  `实测技能伤害 5★/1★ = ${starRatio.toFixed(3)} = 属性涨幅 ${atkGain.toFixed(3)} × 技能等级 ${skillGain.toFixed(3)}` +
  `（期望 ${skillPowerMult(5)}）`,
);
ok(Math.abs((star1.skillPower ?? 0) - 1) < 1e-9, '1★ 技能等级 1（无加成，不是"开局就满级"）');
ok(Math.abs((star5.skillPower ?? 0) - skillPowerMult(5)) < 1e-9, '5★ 技能效果 +72%（18%/星）');
ok(Math.abs((star5.skillCdr ?? 0) - skillStarCdr(5)) < 1e-9, '5★ 技能 CD −16%（4%/星）');
ok(Math.abs(skillGain - skillPowerMult(5)) < 0.02, '星级乘子真的乘进了签名技伤害（已剔除属性成长）');
ok(skillGain > 1.05, '1★ 与 5★ 的技能强度确实有差别（不是"初始就满级"）');

// ③ 召唤物 / 分身编号唯一。旧实现用 `'sum'+floor(time*1000)+kind` 拼 id，
// 同一 tick 两名召唤师出同类召唤物必然撞号；id 又是 targetId/damagers/寻路缓存的主键。
// 这里用三召唤师 + Boss 层（boss_split 分身）压满生成路径，逐 tick 校验 id 集合无重复。
let idCollisions = 0;
let peakUnits = 0;
let spawnedTotal = 0;
for (let s = 0; s < 8; s++) {
  const arena = ARENAS.A1;
  const spawns = parseSpawns(arena);
  const layer = 5 + s;
  const rng = mulberry32(2000 + s);
  const sc = enemyScale(layer);
  const allies = [7, 7, 7].map((i, k) => {
    const u = makeAlly(HEROES[i], 5 + layer, []); // 造物术师 ×3（含 legion 特性额外补一只）
    const p = spawns.ally[k % spawns.ally.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  const enemies = buildWaves(rng, layer, true)[0].map((e, k) => {
    const u = makeEnemy(e, 5 + layer, sc.hp, sc.dmg);
    const p = spawns.enemy[k % spawns.enemy.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  const sim = new BattleSim([...allies, ...enemies], arena, 2000 + s);
  const seen = new Set<string>();
  for (let i = 0; i < 20 * 90 && !sim.over; i++) {
    sim.tick(TICK);
    const ids = sim.units.map((u) => u.id);
    if (new Set(ids).size !== ids.length) idCollisions++;
    for (const id of ids) seen.add(id);
    peakUnits = Math.max(peakUnits, ids.length);
  }
  spawnedTotal += [...seen].filter((id) => !id.startsWith('u')).length;
}
console.log(`    ③ 生成物：8 局共派生 ${spawnedTotal} 个场内编号，场上峰值 ${peakUnits} 单位，撞号 ${idCollisions} 次`);
ok(spawnedTotal > 0, '召唤物 / 分身确实生成了（探针有效，不是空跑）');
ok(idCollisions === 0, '召唤物 / 分身编号全局唯一（无同 tick 撞号）');

// ④ 个体姓名：每份副本一个随机名字，不再有「xxx II / xxx III」后缀，同队不撞名。
const team: HeroDef[] = [];
const taken = new Set<string>();
for (let i = 0; i < 12; i++) {
  const h = variateHero(HEROES[i % 9], 31337 + i * 7919, taken);
  taken.add(h.personalName ?? '');
  team.push(h);
}
const names = team.map((h) => displayName(h));
const suffixed = names.filter((n) => /\s(?:[IVX]+|\d+)$/.test(n) || /[0-9]/.test(n));
console.log(`    ④ 姓名：${names.slice(0, 6).join('、')} …（共 ${names.length}）`);
ok(team.every((h) => !!h.personalName), '每份副本都拿到了个体姓名');
ok(suffixed.length === 0, '显示名不含罗马数字 / 阿拉伯数字后缀');
ok(new Set(names).size === names.length, '同队姓名去重（12 份副本无重名）');
ok(
  variateHero(HEROES[0], 777).personalName === variateHero(HEROES[0], 777).personalName,
  '姓名由种子确定性派生（同 seed 同名）',
);
ok(
  variateHero({ ...HEROES[0], personalName: '孙澜' }, 999).personalName === '孙澜',
  '已有姓名的副本不会被重摇（升星 / 换装不改名）',
);

// ⑤ 性格索敌。受控摆位 + 只跑 1 tick：被测单位排在 units[0]，
// 索敌发生在场上任何人移动之前，故观测到的 targetId 就是纯粹的性格选择结果。
function probeTarget(
  personality: PersonalityId | undefined,
  self: [number, number],
  mates: Array<[number, number]>,
  foes: Array<{ tag: string; x: number; y: number; hpFrac: number; boss?: boolean }>,
): string {
  const arena = ARENAS.A1;
  const me = makeAlly(HEROES[2], 10, []); // 破阵猛将：近战、无召唤、无开局强制大招
  me.x = self[0]; me.y = self[1];
  me.personality = personality;
  const allies = [me, ...mates.map(([x, y]) => {
    const m = makeAlly(HEROES[2], 10, []);
    m.x = x; m.y = y;
    return m;
  })];
  const tagOf = new Map<string, string>();
  const enemies = foes.map((f) => {
    const u = makeEnemy(enemyDef(f.boss ? 'e_boss_colossus' : 'e_physTank_a'), 10, f.boss ? 6 : 1, 0);
    u.x = f.x; u.y = f.y;
    u.hp = Math.max(1, Math.round(u.maxHp * f.hpFrac));
    tagOf.set(u.id, f.tag);
    return u;
  });
  const sim = new BattleSim([...allies, ...enemies], arena, 1);
  sim.tick(TICK);
  return tagOf.get(me.targetId ?? '') ?? '(none)';
}

// S1：最近的是残血，中距的是满血 → 分辨「不畏强暴」
const S1: Array<{ tag: string; x: number; y: number; hpFrac: number }> = [
  { tag: '近·残血', x: 6, y: 6, hpFrac: 0.25 },
  { tag: '中·满血', x: 8, y: 6, hpFrac: 1.0 },
  { tag: '远·满血', x: 11, y: 6, hpFrac: 1.0 },
];
// S2：最近的是满血，中距的是残血 → 分辨「猎手」
const S2: Array<{ tag: string; x: number; y: number; hpFrac: number }> = [
  { tag: '近·满血', x: 6, y: 6, hpFrac: 1.0 },
  { tag: '中·残血', x: 8, y: 6, hpFrac: 0.15 },
  { tag: '远·满血', x: 11, y: 6, hpFrac: 1.0 },
];
// S3：后排离我更近、前排更远 → 只有「攻坚者」会舍近求远打前排
const S3: Array<{ tag: string; x: number; y: number; hpFrac: number }> = [
  { tag: '敌前排', x: 9, y: 6, hpFrac: 1.0 },
  { tag: '敌后排', x: 8, y: 11, hpFrac: 1.0 },
];
// S4：前排离我更近、后排更远 → 只有「专业刺客」会绕远打后排
const S4: Array<{ tag: string; x: number; y: number; hpFrac: number }> = [
  { tag: '敌前排', x: 6, y: 6, hpFrac: 1.0 },
  { tag: '敌后排', x: 12, y: 11, hpFrac: 1.0 },
];
// S5：近处小怪 vs 远处 Boss → 分辨「救困扶危」
const S5: Array<{ tag: string; x: number; y: number; hpFrac: number; boss?: boolean }> = [
  { tag: '近·小怪', x: 6, y: 6, hpFrac: 1.0 },
  { tag: '远·Boss', x: 10, y: 6, hpFrac: 1.0, boss: true },
];
const CENTER: Array<[number, number]> = [[3, 2]]; // 队友：把「阵型重心」拉到 (3,6)，前后排才有意义

const picks = {
  valiant: probeTarget('valiant', [3, 6], [], S1),
  hunter: probeTarget('hunter', [3, 6], [], S2),
  breaker: probeTarget('breaker', [3, 10], CENTER, S3),
  assassin: probeTarget('assassin', [3, 10], CENTER, S4),
  savior: probeTarget('savior', [3, 6], [], S5),
  steadyS1: probeTarget('steady', [3, 6], [], S1),
  steadyS2: probeTarget('steady', [3, 6], [], S2),
  steadyS3: probeTarget('steady', [3, 10], CENTER, S3),
  steadyS4: probeTarget('steady', [3, 10], CENTER, S4),
  steadyS5: probeTarget('steady', [3, 6], [], S5),
};
console.log('    ⑤ 性格选靶:', JSON.stringify(picks, null, 0));
ok(picks.valiant === '中·满血', '不畏强暴：越过更近的残血，优先满血目标（>80%）');
ok(picks.hunter === '中·残血', '猎手：越过更近的满血，优先残血目标');
ok(picks.breaker === '敌前排', '攻坚者：舍近求远，优先敌方前排');
ok(picks.assassin === '敌后排', '专业刺客：绕过前排，优先敌方后排');
ok(picks.savior === '远·Boss', '救困扶危：优先敌方最强者');
ok(
  picks.steadyS1 === '近·残血' && picks.steadyS2 === '近·满血' &&
  picks.steadyS3 === '敌后排' && picks.steadyS4 === '敌前排' && picks.steadyS5 === '近·小怪',
  '随遇而安：五个场景全部选最近的（保留 v3.0 默认行为，作为对照组）',
);

// 性格生成：6 种、加权随机、种子确定
const rollCount: Record<string, number> = {};
const rr = mulberry32(4242);
for (let i = 0; i < 3000; i++) {
  const p = rollPersonality(rr());
  rollCount[p] = (rollCount[p] ?? 0) + 1;
}
console.log('    ⑤ 性格分布:', JSON.stringify(rollCount));
ok(PERSONALITY_IDS.length === 6, '性格共 6 种（5 种偏好 + 随遇而安）');
ok(PERSONALITY_IDS.every((p) => !!PERSONALITIES[p]?.cn && !!PERSONALITIES[p]?.desc), '每种性格都有中文名与说明（面板可展示）');
ok(PERSONALITY_IDS.every((p) => (rollCount[p] ?? 0) > 0), '6 种性格都能被摇到（无死档位）');
ok(
  variateHero(HEROES[0], 20260808).personality === variateHero(HEROES[0], 20260808).personality,
  '性格由种子确定性派生（同 seed 同性格）',
);
ok(
  variateHero({ ...HEROES[0], personality: 'assassin' }, 555).personality === 'assassin',
  '已有性格的副本不会被重摇（性格是副本的固有属性）',
);

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
