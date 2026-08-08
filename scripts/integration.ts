// v1.6 完整流程集成测试（无头）。
//
// smoke.ts 只验证「战斗引擎本身不崩」，但 v1.6 的改动大半在战斗之外：
// 锻造转移 / 合成升星 / 五星突破 / 1 金币刷新 / 倍速持久化，
// 这些都挂在 store 上，任何一处抛异常玩家就会卡在休整界面出不去。
//
// 所以这里直接驱动真实 store，把「战斗 → 掉落 → 开箱 → 商店 → 锻造 →
// 合成 → 招募 → 穿戴 → 下一层」整条循环跑满 30 层 × 多次开局，
// 每层结束做一次全量不变量体检。目标：证明当前版本能完整运行，可以发布。
import { useGame, BREAKTHROUGH_MAIN_CHANCE } from '../src/game/state/store';
import { HEROES } from '../packages/core/src/content/heroes';
import { genLayer } from '../packages/core/src/gen/levelGen';
import { makeAlly, makeEnemy } from '../packages/core/src/engine/unit';
import { applyRelics, BattleSim } from '../packages/core/src/engine/battle';
import { enemyScale, DEMO_CAP, capFor, NOVICE_CAP, ENDLESS_CAP } from '../packages/core/src/engine/scaling';
import { mulberry32 } from '../packages/core/src/engine/rng';
import {
  fuseKindOf, fuseEquipment, transferAffixes, generateEquipment, eqStarMult,
  rollDrops, rollShopStock, equipScore,
} from '../packages/core/src/content/equipment';
import { makeConsumable, dominantPrimary } from '../packages/core/src/content/consumables';
import { variateHero } from '../packages/core/src/content/variant';
import { TUTORIAL, TUTORIAL_MODE } from '../packages/core/src/content/tutorial';
import { Equipment, Unit, AffixKey, Affix, HeroDef, PrimaryAttrs, Rarity, PRIMARY_KEYS } from '../packages/core/src/types';

const TICK = 1 / 20;
const g = () => useGame.getState();

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) fail++;
};

// startRun 内部用 Math.random() 取 seed；替换成确定性源，让整轮集成测试可复现。
function seedRandom(s: number) {
  const r = mulberry32(s);
  Math.random = r as unknown as () => number;
}

// ── 不变量体检 ───────────────────────────────────────────────
interface Violation { rule: string; detail: string }
const violations: Violation[] = [];
const vio = (rule: string, detail: string) => {
  if (violations.length < 40) violations.push({ rule, detail });
};

function allEquipment(): Equipment[] {
  const s = g();
  const worn = Object.keys(s.equipped).flatMap((k) => s.equipped[k] ?? []);
  // v1.7 §3：pendingDrops 是 Chest[]，只有 equip_* 档携带 equipment
  const pending = s.pendingDrops.flatMap((d) => (d.equipment ? [d.equipment] : []));
  // v1.7 §4：shopStock 是 { equipment, consumables }，只取装备做实例唯一性检查
  return [...s.inventory, ...pending, ...s.shopStock.equipment, ...worn];
}

function checkInvariants(tag: string) {
  const s = g();

  if (s.gold < 0) vio('金币非负', `${tag} gold=${s.gold}`);

  // 装备实例唯一：同一件不能既在背包又穿在身上（equipItem 的摘下逻辑一旦漏掉就会复制装备）
  const ids = allEquipment().map((e) => e.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) { vio('装备实例唯一', `${tag} 重复 id=${id}`); break; }
    seen.add(id);
  }

  for (const e of allEquipment()) {
    // 需求 4：百分比词条每种最多一条
    const pct = e.affixes.filter((a) => a.mode === 'pct').map((a) => a.key);
    if (new Set(pct).size !== pct.length) vio('pct 每种唯一', `${tag} ${e.id} ${pct.join(',')}`);
    // 需求 5：星级只属于红装且封顶 5
    const st = e.star ?? 1;
    if (st < 1 || st > 5) vio('装备星级 1–5', `${tag} ${e.id} star=${st}`);
    if (e.rarity !== 'red' && st !== 1) vio('非红装无星级', `${tag} ${e.id} ${e.rarity} star=${st}`);
    if (e.affixes.length === 0) vio('词条非空', `${tag} ${e.id}`);
    for (const a of e.affixes) {
      if (!Number.isFinite(a.value)) vio('词条数值有限', `${tag} ${e.id} ${a.key}=${a.value}`);
    }
  }

  if (s.run) {
    for (const h of s.run.team) {
      const st = h.star ?? 1;
      if (st < 1 || st > 5) vio('角色星级 1–5', `${tag} ${h.id} star=${st}`);
      for (const k of Object.keys(h.bonusPct ?? {}) as AffixKey[]) {
        const v = (h.bonusPct as Record<string, number>)[k];
        if (!Number.isFinite(v) || v < 0) vio('突破加成有效', `${tag} ${h.id} ${k}=${v}`);
      }
    }
    if (s.run.team.length > 7) vio('队伍 ≤7', `${tag} ${s.run.team.length}`);
  }

  for (const hid of Object.keys(s.equipped)) {
    const n = (s.equipped[hid] ?? []).length;
    if (n > 6) vio('装备槽 ≤6', `${tag} ${hid} 穿了 ${n} 件`);
  }

  if (s.fusedThisLayer > 2) vio('每层合成 ≤2', `${tag} ${s.fusedThisLayer}`);
}

// ── 一层战斗（完全镜像 BattleScreen 的构造流程）────────────────
function fightLayer(): { result: 'win' | 'lose' | 'draw'; steps: number; sim: BattleSim } {
  const { run, equipped } = g();
  if (!run) return { result: 'draw', steps: 0, sim: null as unknown as BattleSim };
  const plan = genLayer(run.layer, run.seed);

  const allies: Unit[] = run.team.map((h, i) => {
    const eqs = equipped[h.uid] ?? [];
    const u = makeAlly(h, 1 + Math.floor((run.layer - 1) / 2), eqs, { burst: !!h.pendingBurst });
    const p = plan.spawnAlly[i % plan.spawnAlly.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  applyRelics(allies, run.relics);

  const scale = enemyScale(run.layer);
  const eLevel = 1 + Math.floor(run.layer / 4);
  const enemies: Unit[] = plan.waves.flat().map((e, i) => {
    const u = makeEnemy(e, eLevel, scale.hp, scale.dmg);
    const p = plan.spawnEnemy[i % plan.spawnEnemy.length];
    u.x = p.x; u.y = p.y;
    return u;
  });

  const sim = new BattleSim([...allies, ...enemies], plan.arena, (run.seed + run.layer) >>> 0);
  let steps = 0;
  while (!sim.over && steps < 20 * 180) { sim.tick(TICK); steps++; }
  return { result: sim.result ?? 'draw', steps, sim };
}

// ── 一次休整（把 Intermission 上玩家能点的按钮全点一遍）────────
interface OpCount {
  open: number; buy: number; sell: number; equip: number; unequip: number;
  forge: number; transfer: number; fuse: number; ascend: number;
  recruit: number; starUp: number; breakthrough: number; refresh: number;
}
const ops: OpCount = {
  open: 0, buy: 0, sell: 0, equip: 0, unequip: 0,
  forge: 0, transfer: 0, fuse: 0, ascend: 0,
  recruit: 0, starUp: 0, breakthrough: 0, refresh: 0,
};

function intermission(layer: number) {
  const S = () => g();

  // ① 开箱
  for (const d of [...S().pendingDrops]) { S().openDrop(d.id); ops.open++; }

  // ② 1 金币刷新（需求 7）：商店与招募各刷一次
  if (S().gold >= 1) {
    const before = S().shopStock.equipment.map((e) => e.id).join(',');
    const goldBefore = S().gold;
    S().refreshShop();
    ops.refresh++;
    if (S().gold !== goldBefore - 1) vio('刷新扣 1 金', `L${layer} ${goldBefore}→${S().gold}`);
    if (S().shopStock.equipment.map((e) => e.id).join(',') === before) vio('刷新换库存', `L${layer} 商店未变`);
    // v1.7 §4：商店 8 个货位中约 20% 是一次性物品（consumables），其余是装备，
    // 因此「装备数量」不再恒为 8，而「货位总数」恒为 8。
    const slots = S().shopStock.equipment.length + S().shopStock.consumables.length;
    if (slots !== 8) vio('刷新后商店共 8 个货位', `L${layer} ${slots}`);
  }
  if (S().gold >= 1) {
    const before = S().recruitPool.map((h) => h.id).join(',');
    const goldBefore = S().gold;
    S().refreshRecruit();
    ops.refresh++;
    if (S().gold !== goldBefore - 1) vio('刷新扣 1 金', `L${layer} 招募 ${goldBefore}→${S().gold}`);
    void before;
  }

  // ③ 招募（v1.7 §1）：重复招募 = 新增一份副本（带独立 uid）。
  //    真实玩家先补人/扩编，再拿余钱买装。先买装会把金币榨干，永远摸不到招募分支。
  for (let i = 0; i < 2; i++) {
    const cost = S().recruitCost();
    if (S().gold < cost) break;
    const pool = S().recruitPool;
    if (pool.length === 0) break;
    const run0 = S().run!;
    if (run0.team.length >= 7) break; // 满编不可再招募
    const fresh = pool.find((h) => !run0.team.some((t) => t.id === h.id));
    const pickHero = fresh ?? pool[0];
    const goldBefore = S().gold;
    S().recruit(pickHero.id);
    if (S().gold === goldBefore) break; // 没扣钱说明被规则挡下，别死循环
    ops.recruit++;
  }

  // ③-b 升星 / 突破（v1.7 §1：与招募解耦，走 upgradeHero）
  {
    const cost = S().recruitCost();
    if (S().gold >= cost && S().run!.team.length > 0) {
      const h = S().run!.team[0];
      const beforeStar = h.star ?? 1;
      const goldBefore = S().gold;
      S().upgradeHero(h.uid);
      if (S().gold !== goldBefore) {
        const after = S().run!.team.find((t) => t.uid === h.uid);
        const afterStar = after?.star ?? 1;
        if (after && afterStar > beforeStar) ops.starUp++;
        else if (S().lastBreakthrough) {
          ops.breakthrough++;
          const bt = S().lastBreakthrough!;
          if (bt.add < 3 || bt.add > 5) vio('突破 3%~5%', `L${layer} +${bt.add}%`);
        }
        if (afterStar > 5) vio('角色星级封顶 5', `L${layer} ${h.id} ${afterStar}★`);
      }
    }
  }

  // ④ 购物：拿招募剩下的钱买装，优先贵的（顺带验证折扣不会把价格算成负数）
  for (let i = 0; i < 4; i++) {
    const disc = S().discount();
    const affordable = [...S().shopStock.equipment]
      .map((e) => ({ e, price: Math.round(e.basePrice * (1 - disc)) }))
      .filter((x) => x.price <= S().gold)
      .sort((a, b) => b.price - a.price);
    if (affordable.length === 0) break;
    const goldBefore = S().gold;
    S().buyItem(affordable[0].e.id);
    ops.buy++;
    if (S().gold > goldBefore) vio('购买不返金', `L${layer}`);
  }

  // ④ 锻造（需求 4）：普通装重 roll + 属性转移
  const normals = S().inventory.filter((e) => e.rarity === 'normal');
  if (normals.length >= 3) {
    const target = normals[0];
    const consume = normals.slice(1, 3).map((e) => e.id);
    const n0 = S().inventory.length;
    S().forge(target.id, consume);
    if (S().inventory.length !== n0 - consume.length) vio('锻造消耗素材', `L${layer} ${n0}→${S().inventory.length}`);
    ops.forge++;
  }
  const inv2 = S().inventory;
  const tgt = inv2.find((e) => e.rarity !== 'normal' && !S().forgedThisLayer.includes(e.id))
    ?? inv2.find((e) => !S().forgedThisLayer.includes(e.id));
  if (tgt) {
    const mats = inv2.filter((e) => e.id !== tgt.id).slice(0, 2).map((e) => e.id);
    if (mats.length > 0) {
      const before = tgt.affixes.length;
      S().transferForge(tgt.id, mats);
      ops.transfer++;
      const after = S().inventory.find((e) => e.id === tgt.id);
      if (!after) vio('转移后目标仍在', `L${layer} ${tgt.id}`);
      else if (after.affixes.length < before) vio('转移不减词条', `L${layer} ${before}→${after.affixes.length}`);
      if (S().lastTransferLogs.length === 0) vio('转移产出日志', `L${layer}`);
    }
  }

  // ⑤ 合成 / 升星（需求 5）
  for (let i = 0; i < 2; i++) {
    const inv = S().inventory;
    let done = false;
    for (let a = 0; a < inv.length && !done; a++) {
      for (let b = a + 1; b < inv.length && !done; b++) {
        if (!S().canFuse(inv[a].id, inv[b].id)) continue;
        const kind = fuseKindOf(inv[a], inv[b]);
        const n0 = inv.length;
        S().fuse(inv[a].id, inv[b].id);
        if (S().inventory.length !== n0 - 1) vio('合成 2 进 1', `L${layer} ${n0}→${S().inventory.length}`);
        if (kind === 'ascend') ops.ascend++; else ops.fuse++;
        done = true;
      }
    }
    if (!done) break;
  }

  // ⑦ 穿戴：每人补满 6 槽，优先高品质（v1.7 §1：装备按 uid 记账）
  const rank: Record<string, number> = { red: 3, orange: 2, blue: 1, normal: 0 };
  const run = S().run!;
  for (const h of run.team) {
    for (let i = 0; i < 6; i++) {
      const worn = (S().equipped[h.uid] ?? []).length;
      if (worn >= 6) break;
      const best = [...S().inventory].sort(
        (a, b) => (rank[b.rarity] - rank[a.rarity]) || (eqStarMult(b) - eqStarMult(a)),
      )[0];
      if (!best) break;
      S().equipItem(h.uid, best.id);
      ops.equip++;
    }
  }

  // ⑧ 卖掉溢出的普通装，回点金币（顺便验证 sell 不会把装备留在背包）
  for (const e of S().inventory.filter((x) => x.rarity === 'normal').slice(0, 3)) {
    const n0 = S().inventory.length;
    S().sellItem(e.id);
    ops.sell++;
    if (S().inventory.length !== n0 - 1) vio('出售移除装备', `L${layer} ${e.id}`);
  }

  // ⑨ 摘下再戴回：equipItem 的「先摘再穿」路径最容易复制装备
  const firstHero = run.team[0];
  const worn0 = S().equipped[firstHero.uid] ?? [];
  if (worn0.length > 0) {
    const it = worn0[0];
    S().unequipItem(firstHero.uid, it.id);
    ops.unequip++;
    const tgtHero = run.team[run.team.length - 1];
    S().equipItem(tgtHero.uid, it.id);
    ops.equip++;
  }
}

// ══════════════════════════════════════════════════════════════
console.log('\n[1] 完整 run 循环（5 次开局 × 最深 30 层，每层跑满休整全流程）');
const runReports: string[] = [];
for (let r = 0; r < 5; r++) {
  seedRandom(20260801 + r * 977);
  useGame.setState({ bestLayer: 0 });
  g().reset();
  const team = [HEROES[r % 9], HEROES[(r + 3) % 9], HEROES[(r + 6) % 9]]; // 三人开局（项目设定）
  g().startRun(team);
  if (!g().run) { vio('startRun 建局', `run${r}`); continue; }

  let deepest = 0;
  let outcome = 'cap';
  for (let layer = 1; layer <= DEMO_CAP; layer++) {
    const fr = fightLayer();
    deepest = layer;
    if (fr.result === 'lose') { outcome = `第 ${layer} 层战败`; break; }
    if (fr.result === 'draw') { outcome = `第 ${layer} 层超时未分胜负`; vio('战斗必分胜负', `run${r} L${layer} ${fr.steps} 步`); break; }
    g().addScore(100 * layer + 50);
    // v1.7 §2：把本场击杀成长写回对应副本（与 BattleScreen.onEnd 一致）
    if (fr.sim) g().commitGrowth(fr.sim.getKillGains());
    g().collectLoot(layer);
    checkInvariants(`run${r}/L${layer}/loot`);
    intermission(layer);
    checkInvariants(`run${r}/L${layer}/inter`);
    // 需求 2：倍速属于跨层偏好，切层不得被重置
    if (layer === 1) g().setBattleSpeed(3);
    if (layer > 1 && g().battleSpeed !== 3) vio('倍速跨层保持', `run${r} L${layer} speed=${g().battleSpeed}`);
    g().setLayer(layer + 1);
    if (g().forgedThisLayer.length !== 0 || g().fusedThisLayer !== 0) vio('切层重置每层限额', `run${r} L${layer}`);
  }
  const s = g();
  runReports.push(
    `    run${r} 阵容[${team.map((h) => h.name).join('/')}] → 第 ${deepest} 层（${outcome}）`
    + ` 队伍${s.run?.team.length ?? 0}人 金币${s.gold} 背包${s.inventory.length}`,
  );
}
runReports.forEach((l) => console.log(l));
console.log('    操作计数:', JSON.stringify(ops));
ok(ops.open > 50 && ops.buy > 5, `经济链路被充分触发（开箱 ${ops.open} / 购买 ${ops.buy}）`);
ok(ops.forge > 0 && ops.transfer > 0, `锻造与属性转移均执行（${ops.forge}/${ops.transfer}）`);
ok(ops.fuse + ops.ascend > 0, `装备合成/升星被执行（升阶 ${ops.fuse} / 升星 ${ops.ascend}）`);
ok(ops.recruit + ops.starUp > 0, `招募与角色升星被执行（入队 ${ops.recruit} / 升星 ${ops.starUp}）`);
ok(ops.refresh > 10, `1 金币刷新被反复使用（${ops.refresh} 次）`);
ok(violations.length === 0, `全流程 0 条不变量违规`);
if (violations.length) violations.forEach((v) => console.log(`      ✗ [${v.rule}] ${v.detail}`));

// ══════════════════════════════════════════════════════════════
console.log('\n[2] 需求 4：属性转移规则（白值可叠任意条 / 每种百分比只留一条）');
{
  const rng = mulberry32(4242);
  let maxFlat = 0, maxPctSameKey = 0, accumulated = 0;
  for (let i = 0; i < 400; i++) {
    const target = generateEquipment(rng, i % 2 ? 'orange' : 'red');
    const mats = [generateEquipment(rng, 'red'), generateEquipment(rng, 'orange'), generateEquipment(rng, 'blue')];
    const { result, logs } = transferAffixes(target, mats, rng);
    const byKeyFlat: Record<string, number> = {};
    const byKeyPct: Record<string, number> = {};
    for (const a of result.affixes) {
      if ((a.mode ?? 'flat') === 'flat') byKeyFlat[a.key] = (byKeyFlat[a.key] ?? 0) + 1;
      else byKeyPct[a.key] = (byKeyPct[a.key] ?? 0) + 1;
    }
    maxFlat = Math.max(maxFlat, result.affixes.filter((a) => (a.mode ?? 'flat') === 'flat').length);
    maxPctSameKey = Math.max(maxPctSameKey, ...Object.values(byKeyPct), 0);
    for (const k of Object.keys(byKeyFlat)) if (byKeyFlat[k] > 1) maxPctSameKey = 99; // 同 key flat 必须合并
    if (logs.some((l) => l.ok && l.note.startsWith('累加'))) accumulated++;
  }
  ok(maxPctSameKey === 1 || maxPctSameKey === 0, `400 次转移中每种百分比最多 1 条（实测上限 ${maxPctSameKey}）`);
  ok(maxFlat >= 4, `白值条目可无限叠加（单件最多 ${maxFlat} 条白值）`);
  ok(accumulated > 100, `同 key 白值走累加而非新增（${accumulated}/400 次出现累加日志）`);
}

console.log('\n[3] 需求 5：合成与红装升星');
{
  const rng = mulberry32(777);
  const blue = () => generateEquipment(rng, 'blue');
  const orange = () => generateEquipment(rng, 'orange');
  const red = (star = 1) => ({ ...generateEquipment(rng, 'red'), star });

  ok(fuseKindOf(blue(), blue()) === 'upgrade', '2 蓝 → 可升阶');
  ok(fuseKindOf(orange(), orange()) === 'upgrade', '2 橙 → 可升阶');
  ok(fuseKindOf(blue(), orange()) === null, '蓝 + 橙 → 不可合成（品质必须相同）');
  ok(fuseKindOf(red(1), red(1)) === 'ascend', '红 + 红 → 升星');
  ok(fuseKindOf(red(5), red(1)) === null, '5★ 红装不可再升星（封顶）');

  const b = fuseEquipment(blue(), blue(), rng);
  ok(b?.rarity === 'orange' && b.opened === true, `2 蓝合成产出橙装且免开箱（${b?.rarity}）`);
  const o = fuseEquipment(orange(), orange(), rng);
  ok(o?.rarity === 'red' && (o.star ?? 1) === 1, `2 橙合成产出 1★ 红装（${o?.rarity} ${o?.star}★）`);

  let cur: Equipment = red(1);
  const chain: number[] = [];
  for (let i = 0; i < 6; i++) {
    const nx = fuseEquipment(cur, red(1), rng);
    if (!nx) break;
    cur = nx; chain.push(cur.star ?? 1);
  }
  ok(chain.join('→') === '2→3→4→5', `红装升星链 1★${chain.length ? '→' + chain.join('→') : ''} 封顶 5★`);
  ok(Math.abs(eqStarMult({ ...cur, star: 5 }) - 2) < 1e-9, '5★ 词条倍率 = 2.00');
}

console.log('\n[4] 需求 6 / v1.7 §1：五星角色升级 → 随机属性突破 3%~5%（与招募解耦）');
{
  seedRandom(31337);
  g().reset();
  const hero = HEROES[0];
  g().startRun([{ ...hero, star: 5 }, HEROES[1], HEROES[2]]);
  const hits: Record<string, number> = {};
  const adds: number[] = [];
  for (let i = 0; i < 60; i++) {
    useGame.setState({ gold: 99999 });
    const run = g().run!;
    // 让种子随迭代变化，模拟不同层/不同交易次数
    useGame.setState({ run: { ...run, layer: 1 + (i % 20), score: run.score + 137 }, tradeCount: i });
    const uid = g().run!.team[0].uid;
    g().upgradeHero(uid);
    const bt = g().lastBreakthrough;
    if (bt) { hits[bt.key] = (hits[bt.key] ?? 0) + 1; adds.push(bt.add); }
  }
  const team0 = g().run!.team[0];
  ok((team0.star ?? 1) === 5, '5★ 角色升级不会超过 5 星');
  ok(adds.length === 60, `60 次升级全部触发突破（实际 ${adds.length}）`);
  ok(adds.every((a) => a >= 3 && a <= 5), `突破幅度全部落在 3%~5%（min=${Math.min(...adds)} max=${Math.max(...adds)}）`);
  ok(Object.keys(hits).length >= 3, `突破属性随机覆盖多项：${JSON.stringify(hits)}`);
  const total = Object.values(team0.bonusPct ?? {}).reduce((s, v) => s + (v as number), 0);
  ok(total > 100, `突破加成持续累积（累计 +${Math.round(total * 10) / 10}%）`);
  // 突破必须真正影响战斗属性
  const plain = makeAlly(hero, 10, []);
  const buffed = makeAlly(team0, 10, []);
  ok(buffed.derived.hp > plain.derived.hp, `突破后派生属性提升（HP ${Math.round(plain.derived.hp)} → ${Math.round(buffed.derived.hp)}）`);
}

console.log('\n[5] 需求 7 / 需求 2：1 金币刷新 与 倍速持久化');
{
  seedRandom(555);
  g().reset();
  g().startRun([HEROES[0], HEROES[1], HEROES[2]]);
  useGame.setState({ gold: 10 });
  const s0 = g().shopStock.equipment.map((e) => e.id).join(',');
  g().refreshShop();
  const s1 = g().shopStock.equipment.map((e) => e.id).join(',');
  g().refreshShop();
  const s2 = g().shopStock.equipment.map((e) => e.id).join(',');
  ok(g().gold === 8, `连刷两次共花 2 金（余 ${g().gold}）`);
  ok(s0 !== s1 && s1 !== s2, '每次刷新库存都不同（种子掺入 refreshCount）');
  useGame.setState({ gold: 0 });
  const before = g().shopStock.equipment.map((e) => e.id).join(',');
  g().refreshShop();
  ok(g().gold === 0 && g().shopStock.equipment.map((e) => e.id).join(',') === before, '金币不足时刷新无效（不会刷出负数）');

  g().collectLoot(1);            // collectLoot 会发奖励金，必须先领再设定基准
  useGame.setState({ gold: 5 });
  const p0 = g().recruitPool.map((h) => h.id).join(',');
  g().refreshRecruit();
  const p1 = g().recruitPool.map((h) => h.id).join(',');
  ok(g().gold === 4 && g().recruitPool.length === 3, `招募刷新扣 1 金且保持 3 人（余 ${g().gold}）`);
  ok(p0 !== p1 || p0 === '', `招募池刷新后发生变化`);

  g().setBattleSpeed(2.5);
  g().setLayer(5);
  g().setScreen('battle');
  g().setScreen('inter');
  ok(g().battleSpeed === 2.5, `倍速跨层跨界面保持（${g().battleSpeed}×）`);
  g().setBattleSpeed(99);
  ok(g().battleSpeed === 4, '倍速上限钳制到 4×');
  g().setBattleSpeed(0.01);
  ok(g().battleSpeed === 0.5, '倍速下限钳制到 0.5×');
}

console.log('\n[6] 需求 3：角色面板算的是真实战斗属性（含装备预览差值）');
{
  const rng = mulberry32(2024);
  const hero = HEROES[4];
  const eq: Equipment[] = [generateEquipment(rng, 'red'), generateEquipment(rng, 'orange')];
  const base = makeAlly(hero, 8, []);
  const withEq = makeAlly(hero, 8, eq);
  const preview = makeAlly(hero, 8, [...eq, generateEquipment(rng, 'red')]);
  const sum = (u: Unit) => u.derived.hp + u.derived.pDmg + u.derived.mDmg + u.derived.pResist + u.derived.mResist;
  ok(sum(withEq) > sum(base), `装备确实进入派生属性（${Math.round(sum(base))} → ${Math.round(sum(withEq))}）`);
  ok(sum(preview) > sum(withEq), `预览一件新装能算出增量（→ ${Math.round(sum(preview))}）`);
  ok(base.traitId !== undefined, `面板可读到角色特性（${hero.name} = ${base.traitId}）`);
}

console.log('\n[7] 需求 1：9 职业特性 / 技能二段 / 体型 数据完整');
{
  ok(HEROES.length === 9, `9 个职业（${HEROES.length}）`);
  ok(HEROES.every((h) => !!h.traitId), '每个职业都绑定了特性');
  const uniqTrait = new Set(HEROES.map((h) => h.traitId));
  ok(uniqTrait.size === 9, `9 种特性互不重复（${uniqTrait.size}）`);
  ok(HEROES.every((h) => !!h.skill), '每个职业都有技能');
  const bodies = new Set(HEROES.map((h) => makeAlly(h, 1, []).bodyType));
  ok(bodies.size >= 3, `体型分布覆盖多种：${[...bodies].join('/')}`);
  ok(HEROES.every((h) => h.basePrimary && h.growth), '一级属性与成长曲线齐备');
}

console.log('\n[8] v1.7 §1：同角色可上场多份 + 出售');
{
  seedRandom(1234);
  g().reset();
  g().startRun([HEROES[0], HEROES[1], HEROES[2]]);
  useGame.setState({ gold: 99999 });
  const id0 = g().run!.team[0].id;
  const uid0 = g().run!.team[0].uid;
  const uid1 = g().run!.team[1].uid;
  // 保证招募池中确实出现该同名英雄（需求 1：副本靠招募池里的 dup 槽产出）
  useGame.setState({ recruitPool: [...g().recruitPool, HEROES[0]] });
  // 招募一个同名副本（重复招募 = 新增一份，不升星）
  g().recruit(id0);
  const team = g().run!.team;
  const sameId = team.filter((h) => h.id === id0);
  ok(sameId.length === 2, `同名角色可上场 2 份（实际 ${sameId.length}）`);
  ok(sameId[0].uid !== sameId[1].uid, '两份副本 uid 不同（装备/成长互不干扰）');
  ok(team.every((h) => !!h.uid), '每名队员都持有 uid');
  // 两份都能各自穿戴（装备按 uid 记账；同一件装备不可能同时在两人身上）
  const someEq = g().shopStock.equipment[0];
  if (someEq) {
    g().buyItem(someEq.id);
    const bought = g().inventory[0];
    g().equipItem(sameId[0].uid, bought.id);
    g().equipItem(sameId[1].uid, bought.id); // 触发「先摘再穿」
    const worn0 = (g().equipped[sameId[0].uid] ?? []).length;
    const worn1 = (g().equipped[sameId[1].uid] ?? []).length;
    ok(worn0 + worn1 <= 1, `装备实例唯一：同一件不可能同时在两份身上（${worn0}+${worn1}）`);
    void uid0; void uid1;
  }
  // 出售其中一份
  const goldBefore = g().gold;
  g().sellHero(sameId[1].uid);
  const team2 = g().run!.team;
  ok(team2.length === team.length - 1, `出售后队伍减少 1 人（剩 ${team2.length}）`);
  ok(team2.some((h) => h.uid === sameId[0].uid), '保留的另一份副本仍在场');
  ok(g().gold > goldBefore, `出售返还金币（${goldBefore}→${g().gold}）`);
  ok(g().equipped[sameId[1].uid] === undefined, '被出售副本的装备栏已清除');
  // 不能卖掉最后一名
  while (g().run!.team.length > 1) g().sellHero(g().run!.team[0].uid);
  const nLast = g().run!.team.length;
  g().sellHero(g().run!.team[0].uid);
  ok(g().run!.team.length === nLast && nLast === 1, '至少保留 1 名勇者（无法卖空）');
}

console.log('\n[9] v1.7 §2：击杀敌方单位 → 击杀者永久成长（基础 核心+0.5 / 二级+1%；击杀者随机 100%~150%、助攻者随机 30%~50%）');
{
  seedRandom(9001);
  g().reset();
  const team = [HEROES[2], HEROES[3], HEROES[4]];
  g().startRun(team);
  const fr = fightLayer();
  const gains = fr.sim.getKillGains();
  const anyGain = Object.keys(gains).length > 0;
  if (anyGain) g().commitGrowth(gains);
  ok(anyGain, `本场有击杀归属到友方（${Object.keys(gains).length} 名勇者获得成长）`);
  const after = g().run!.team;
  const grew = after.some((h) =>
    h.growthBonus &&
    (Object.values(h.growthBonus.primary ?? {}).some((v) => (v as number) > 0) ||
     Object.values(h.growthBonus.secondaryPct ?? {}).some((v) => (v as number) > 0)));
  ok(grew, '成长已写回对应副本（核心属性或二级属性出现正增量）');
  // 至少一名获得成长者其对应核心属性比同模板裸值高（核心 +0.5 × [1.0,1.5] 恒为正增量）
  const h0 = after.find((h) => h.growthBonus);
  if (h0) {
    const plain = makeAlly(HEROES.find((x) => x.id === h0.id)!, 10, []);
    const buffed = makeAlly(h0, 10, []);
    const up = (['con', 'str', 'agi', 'int'] as const).some(
      (k) => buffed.primary[k] > plain.primary[k],
    );
    ok(up, `击杀成长反映到一级属性（${h0.name} 已永久获得正核心成长）`);
  }
  // 确定性校验：随机倍率仍由种子复现 —— 同 seed 重跑，击杀成长账本逐字节一致
  // 注意：重跑前必须重新 seedRandom(9001)，否则模块 RNG 已被首跑消耗，run.seed 不同会令战斗种子漂移。
  // 确定性校验：随机倍率仍由种子复现 —— 同 seed 重跑，击杀成长数值逐字节一致。
  // 注意：英雄 uid 由全局自增计数器分配，两次 startRun 的 uid 标签不同；但成长数值必须完全一致，
  // 故按"成长值"归一化比较（忽略 uid 标签）。
  seedRandom(9001); g().reset(); g().startRun(team); const fr2 = fightLayer();
  const norm = (g: Record<string, HeroGrowth>) =>
    Object.values(g).map((x) => JSON.stringify(x)).sort().join('|');
  ok(norm(fr2.sim.getKillGains()) === norm(gains),
    '击杀成长随机倍率由种子确定（同 seed 重跑成长数值一致）');
}

console.log('\n[10] v1.7 §3：宝箱数量随关型 + 掉落分布 40/20/20/10/10');
{
  const rng = mulberry32(31313);
  let normalOk = true, bossOk = true;
  for (let i = 0; i < 200; i++) {
    const nN = rollDrops(rng, 5, false).length;
    const nB = rollDrops(rng, 10, true).length;
    if (nN < 3 || nN > 6) normalOk = false;
    if (nB < 8 || nB > 12) bossOk = false;
  }
  ok(normalOk, '小关卡掉落 3~6 个箱');
  ok(bossOk, 'Boss 关掉落 8~12 个箱');
  // 分布统计（5000 次）
  const rng2 = mulberry32(7);
  const cnt: Record<string, number> = { equip_normal: 0, gold_small: 0, equip_high: 0, equip_rare: 0, gold_large: 0 };
  const N = 5000;
  for (let i = 0; i < N; i++) cnt[rollDrops(rng2, 5, false)[0].reward]++;
  const pct = (k: string) => Math.round((cnt[k] / N) * 100);
  ok(Math.abs(pct('equip_normal') - 40) <= 4, `普通装备≈40%（实测 ${pct('equip_normal')}%）`);
  ok(Math.abs(pct('gold_small') - 20) <= 4, `少量金钱≈20%（实测 ${pct('gold_small')}%）`);
  ok(Math.abs(pct('equip_high') - 20) <= 4, `高级装备≈20%（实测 ${pct('equip_high')}%）`);
  ok(Math.abs(pct('equip_rare') - 10) <= 3, `稀有装备≈10%（实测 ${pct('equip_rare')}%）`);
  ok(Math.abs(pct('gold_large') - 10) <= 3, `大量金钱≈10%（实测 ${pct('gold_large')}%）`);
}

console.log('\n[11] v1.7 §4：商店一次性物品（20% 货位）与药剂效果');
{
  // 逐货位 20% 概率产出一次性物品
  const rng = mulberry32(24680);
  let conSlots = 0, totalSlots = 0;
  for (let i = 0; i < 200; i++) {
    const stock = rollShopStock(rng, 8);
    totalSlots += 8;
    conSlots += stock.consumables.length;
  }
  const rate = conSlots / totalSlots;
  ok(rate > 0.15 && rate < 0.25, `每个货位约 20% 产出一次性物品（实测 ${(rate * 100).toFixed(1)}%）`);

  // 购买 + 使用成长药剂 → 永久成长
  seedRandom(13579);
  g().reset();
  g().startRun([HEROES[0], HEROES[1], HEROES[2]]);
  useGame.setState({ gold: 99999 });
  const grow = makeConsumable('growth');
  useGame.setState({ consumables: [grow] });
  const uid = g().run!.team[0].uid;
  g().useConsumable(grow.id, uid);
  const gp1 = g().run!.team[0].growthBonus;
  ok(
    !!gp1 &&
    (Object.values(gp1.primary ?? {}).some((v) => (v as number) > 0) ||
     Object.values(gp1.secondaryPct ?? {}).some((v) => (v as number) > 0)),
    '成长药剂写入永久成长（核心 +0.5 / 二级 0.5%~2%）',
  );
  ok(g().consumables.length === 0, '使用后的药剂被消耗（一次性）');

  // 爆发药剂 → 标记下一场生效，进入战斗消耗
  const burst = makeConsumable('burst');
  useGame.setState({ consumables: [burst] });
  g().useConsumable(burst.id, uid);
  ok(g().run!.team[0].pendingBurst === true, '爆发药剂标记「下一场战斗生效」');
  g().consumeBurst(uid);
  ok(g().run!.team[0].pendingBurst === false, '进入战斗后爆发标记被消耗');
}

console.log('\n[12] v2.1 需求：角色特性分离（同角色基础属性与体型个体差异化）');
{
  // 1) variateHero 确定性：同 seed 必须逐字节一致（不破坏可复现）
  const r1 = variateHero(HEROES[0], 999);
  const r2 = variateHero(HEROES[0], 999);
  ok(
    JSON.stringify(r1.basePrimary) === JSON.stringify(r2.basePrimary) && r1.bodyType === r2.bodyType,
    'variateHero 同 seed 完全确定（可复现）',
  );

  // 2) 差异化：扫一批 seed，同角色应派生出多种不同基础属性 / 体型组合
  const seen = new Set<string>();
  for (let s = 1; s <= 60; s++) {
    const v = variateHero(HEROES[0], s * 131 + 7);
    seen.add(`${v.bodyType}|${v.basePrimary.con}|${v.basePrimary.str}|${v.basePrimary.agi}|${v.basePrimary.int}`);
  }
  ok(seen.size > 1, `同角色可派生多种差异化个体（实测 ${seen.size} 种组合）`);

  // 3) 真实招募链路：同一英雄的模板 + 多份招募副本，个体之间基础属性/体型不全相同
  seedRandom(555123);
  g().reset();
  g().startRun([HEROES[0], HEROES[1], HEROES[2]]);
  useGame.setState({ gold: 99999 });
  const id0 = g().run!.team[0].id;
  // 注：recruit() 会移除招募池中该英雄的全部条目，故每次招募前需重新投放该英雄
  useGame.setState({ recruitPool: [...g().recruitPool, HEROES[0]] });
  g().recruit(id0);
  useGame.setState({ recruitPool: [...g().recruitPool, HEROES[0]] });
  g().recruit(id0);
  const copies = g().run!.team.filter((h) => h.id === id0);
  ok(copies.length === 3, `同名角色上场 3 份（模板 + 2 招募副本，实际 ${copies.length}）`);
  const distinct = new Set(copies.map((h) => `${h.bodyType}|${h.basePrimary.con}|${h.basePrimary.str}|${h.basePrimary.agi}|${h.basePrimary.int}`));
  ok(distinct.size > 1, `三份副本并非数值/体型克隆（${distinct.size}/${copies.length} 种不同组合）`);
  // 差异化必须真正进入战斗属性（面板与实战共用 makeAlly）
  const u0 = makeAlly(copies[0], 10, []);
  const u1 = makeAlly(copies[1], 10, []);
  ok(u0.derived.hp !== u1.derived.hp || u0.bodyType !== u1.bodyType, '差异化反映到派生属性（HP/体型不雷同）');
}

console.log('\n[13] v2.2 需求：新手 / 普通无尽 / 铁人无尽 三模式体系');
{
  // capFor 返回正确封顶
  ok(capFor('novice') === NOVICE_CAP && NOVICE_CAP === 5, `新手模式封顶 = NOVICE_CAP(${NOVICE_CAP})`);
  ok(capFor('normal') === ENDLESS_CAP && capFor('ironman') === ENDLESS_CAP && ENDLESS_CAP === 500,
     `普通无尽 / 铁人无尽封顶 = ENDLESS_CAP(${ENDLESS_CAP})`);

  // 新手通关（到达封顶并胜利）→ 解锁普通 + 铁人无尽，lastResult.mode = 'novice'
  seedRandom(20260802);
  useGame.setState({ selectedMode: 'novice', endlessUnlocked: false });
  g().reset();
  const team = [HEROES[0], HEROES[1], HEROES[2]];
  g().startRun(team); // 默认 selectedMode = 'novice'
  ok(g().run!.mode === 'novice', 'startRun 默认进入新手模式');
  ok(g().endlessUnlocked === false, '初始无尽模式未解锁');
  g().finishBattle(true, NOVICE_CAP, 9999);
  ok(g().endlessUnlocked === true, '新手模式通关第 5 层 → 同时解锁普通无尽 + 铁人无尽');
  ok(g().lastResult?.mode === 'novice' && g().lastResult?.win === true, 'lastResult 记录为新手模式胜利');

  // 无尽未解锁时 startRun 强制回退新手（安全护栏，覆盖 normal 与 ironman）
  g().reset();
  useGame.setState({ endlessUnlocked: false, selectedMode: 'normal' });
  g().startRun(team);
  ok(g().run!.mode === 'novice', '普通无尽未解锁时 startRun 强制回退新手模式');
  g().reset();
  useGame.setState({ endlessUnlocked: false, selectedMode: 'ironman' });
  g().startRun(team);
  ok(g().run!.mode === 'novice', '铁人无尽未解锁时 startRun 强制回退新手模式');

  // 解锁后可进入普通无尽；登顶 500 层记录为普通无尽胜利且不撤销解锁
  useGame.setState({ endlessUnlocked: true, selectedMode: 'normal' });
  g().startRun(team);
  ok(g().run!.mode === 'normal', '解锁后 startRun 可进入普通无尽模式');
  g().finishBattle(true, ENDLESS_CAP, 12345);
  ok(g().lastResult?.mode === 'normal' && g().lastResult?.win === true, '普通无尽登顶 500 层 → 记录为普通无尽胜利');
  ok(g().endlessUnlocked === true, '无尽胜利不撤销已解锁状态');

  // 铁人无尽同样可进入，且 mode 正确（与普通无尽区别仅在阵亡是否永久消失）
  useGame.setState({ endlessUnlocked: true, selectedMode: 'ironman' });
  g().startRun(team);
  ok(g().run!.mode === 'ironman', '解锁后 startRun 可进入铁人无尽模式');

  // selectedMode 是跨局的玩家偏好，reset 不清除
  g().setSelectedMode('ironman');
  g().reset();
  ok(g().selectedMode === 'ironman', 'selectedMode 跨 reset 保持（模式选择是玩家偏好）');
}

console.log('\n[14] v2.2 铁人无尽永久死亡（permadeath）+ 新手弹窗教学配置');
{
  // ── 三模式封顶一致 ──
  ok(capFor('novice') === 5 && capFor('normal') === 500 && capFor('ironman') === 500,
     '三模式封顶：新手=5，普通/铁人均=500');

  // ── 铁人永久死亡：阵亡勇者从队伍永久移除，装备卸回背包，至少保留 1 人 ──
  seedRandom(20260803);
  useGame.setState({ endlessUnlocked: true, selectedMode: 'ironman' });
  g().reset();
  const team = [HEROES[0], HEROES[1], HEROES[2]];
  g().startRun(team);
  const victim = g().run!.team[0];
  // 给 victim 直接置 2 件装备（不走 equipItem，避免依赖背包前置），验证移除时卸回背包
  const starter = Array.from({ length: 6 }, (_, i) => generateEquipment(mulberry32(2000 + i), 'normal'));
  useGame.setState({
    inventory: [...g().inventory, ...starter],
    equipped: { ...g().equipped, [victim.uid]: starter.slice(0, 2) },
  });
  ok((g().equipped[victim.uid] ?? []).length === 2, '阵亡前置：victim 穿戴 2 件');
  const invBefore = g().inventory.length;

  g().removeDeadAllies([victim.uid]);
  ok(!g().run!.team.some((h) => h.uid === victim.uid), '铁人模式：阵亡勇者从队伍永久移除');
  ok((g().equipped[victim.uid] ?? []).length === 0, '阵亡勇者装备已卸下');
  ok(g().inventory.length === invBefore + 2, `阵亡勇者装备回到背包（${invBefore}→${g().inventory.length}）`);
  ok(g().run!.team.length === 2, `队伍剩余 ${g().run!.team.length} 人（原 3 人）`);

  // 不会把队伍清空：守卫拦截「移除所有成员」，至少保留 1 名
  g().removeDeadAllies([g().run!.team[0].uid]); // 2 → 1
  ok(g().run!.team.length === 1, '永久死亡保护：可移除到仅剩 1 名');
  g().removeDeadAllies(g().run!.team.map((h) => h.uid)); // 尝试清空 → 被守卫拦截
  ok(g().run!.team.length === 1, '永久死亡保护：不会把队伍清空（至少保留 1 名）');

  // ── BattleSim 阵亡追踪：铁人模式据此永久移除（killIfDown 写入 deadAllies）──
  const plan = genLayer(1, 12345);
  const ally = makeAlly(HEROES[0], 1, [], { burst: false });
  const enemy = makeEnemy(plan.waves.flat()[0], 1, 1, 1);
  const sim = new BattleSim([ally, enemy], plan.arena, 999);
  ally.hp = 0; // killIfDown 仅在 hp<=0 时登记阵亡
  (sim as unknown as { killIfDown: (u: Unit, k?: Unit) => void }).killIfDown(ally, undefined);
  ok(sim.getDeadAllyUids().includes(ally.heroUid), 'BattleSim 记录阵亡友方 uid（铁人永久死亡依据）');

  // ── 新手教学配置：仅新手模式触发，6 组教学，覆盖全部核心操作 ──
  ok(TUTORIAL_MODE === 'novice', '教学仅在新手模式触发（TUTORIAL_MODE = novice）');
  ok(TUTORIAL.length === 6, `教学覆盖 6 组（实际 ${TUTORIAL.length}）`);
  const gotLayers = TUTORIAL.map((grp) => grp.layer);
  ok(JSON.stringify(gotLayers) === JSON.stringify([1, 1, 2, 3, 4, 5]), `教学层序 = ${gotLayers.join(',')}`);
  // v2.6：装备教学扩到三条链路（合成/附魔/重铸），组内步数不再恒为 2，只约束 2~4 步
  // ——超过 4 步一口气弹完会把玩家从操作里赶出去，那是教学在妨碍教学。
  ok(TUTORIAL.every((grp) => grp.steps.length >= 2 && grp.steps.length <= 4), '每组 2~4 个教学点');
  const anchors = TUTORIAL.flatMap((grp) => grp.steps.map((s) => s.anchorId));
  ok(anchors.every((a) => typeof a === 'string' && a.length > 0), '所有教学点都有 anchorId');
  ok(
    anchors.includes('tut-hero-panel') && anchors.includes('tut-hero-sell') &&
    anchors.includes('tut-fuse') && anchors.includes('tut-forge-reroll') &&
    anchors.includes('tut-shop-buy') && anchors.includes('tut-shop-refresh') &&
    anchors.includes('tut-formation'),
    '核心 6 操作 + 射程站位教学点齐备（升星/卖出/合成/重铸/购买/刷新/射程站位）',
  );
  // v2.6 §1：装备三链路教学齐备 —— 合成（2 蓝→1 橙）/ 附魔（白→蓝属性转移）/ 刷新（白装重铸）
  ok(anchors.includes('tut-forge-transfer'), 'v2.6 白装附魔（属性转移）教学点存在');
  ok(anchors.includes('tut-inventory'), 'v2.6 初始装备包教学点存在');

  // ── v2.6 §1 教学初始装备包：新手模式开局 2 蓝 + 2 白 ──
  {
    const g = useGame.getState();
    g.reset();
    useGame.setState({ selectedMode: 'novice' });
    useGame.getState().startRun(HEROES.slice(0, 3), 'novice');
    const inv = useGame.getState().inventory;
    ok(inv.length === 4, `新手开局发 4 件初始装备（实际 ${inv.length}）`);
    ok(inv.filter((e) => e.rarity === 'blue').length === 2, '初始包含 2 件蓝装（够演示 2 蓝→1 橙）');
    ok(inv.filter((e) => e.rarity === 'normal').length === 2, '初始包含 2 件白装（附魔素材 + 重铸对象）');
    ok(inv.every((e) => e.opened), '初始装备全部已开箱（直接可用）');
    // 合成链路真的能跑通：两件蓝装 → 1 件橙装
    const blues = inv.filter((e) => e.rarity === 'blue');
    ok(useGame.getState().canFuse(blues[0].id, blues[1].id), '2 件初始蓝装可合成');
    useGame.getState().fuse(blues[0].id, blues[1].id);
    const after = useGame.getState().inventory;
    ok(after.length === 3, `合成后背包 4→3（实际 ${after.length}）`);
    ok(after.some((e) => e.rarity === 'orange'), '合成产出 1 件橙装');
    // 附魔链路：白装词条转移进目标装
    const inv2 = useGame.getState().inventory;
    const target = inv2.find((e) => e.rarity === 'orange')!;
    const mat = inv2.find((e) => e.rarity === 'normal')!;
    useGame.getState().transferForge(target.id, [mat.id]);
    const inv3 = useGame.getState().inventory;
    ok(!inv3.some((e) => e.id === mat.id), '附魔后素材白装已销毁');
    ok(inv3.some((e) => e.id === target.id), '附魔后目标装仍在背包');

    // 无尽模式不发初始包（白手起家是核心张力）
    useGame.getState().reset();
    useGame.setState({ endlessUnlocked: true });
    useGame.getState().startRun(HEROES.slice(0, 3), 'normal');
    ok(useGame.getState().inventory.length === 0, '普通无尽不发初始装备包');
    useGame.getState().reset();
  }
}

  // ── v2.7 §1.1 商店一键全买 + 买空自动免费刷新 ──────────────
  console.log('\n[15] v2.7 §1.1：商店一键全买 + 买空自动免费刷新');
  {
    const discountOf = (tc: number) => Math.max(0, Math.min(0.5, tc * 0.025));

    // 15a：金币充足 → 整批买空 → 自动免费刷新；花费与逐件折扣完全一致
    seedRandom(770001);
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'novice');
    useGame.setState({ gold: 9_999_999, tradeCount: 0, inventory: [], consumables: [] });

    const before = g().shopStock;
    const total = before.equipment.length + before.consumables.length;
    ok(total > 0, `商店有库存可买（${total} 件）`);

    // 复算逐件折扣后的预期总花费（先便宜后贵，与 buyAllShop 内部顺序一致）
    const order = [
      ...before.equipment.map((e) => ({ id: e.id, p: e.basePrice })),
      ...before.consumables.map((c) => ({ id: c.id, p: c.basePrice })),
    ].sort((a, b) => a.p - b.p);
    let tc = g().tradeCount;
    let expectedCost = 0;
    for (const it of order) expectedCost += Math.round(it.p * (1 - discountOf(tc++)));

    const goldBefore = g().gold;
    const bought = g().buyAllShop();
    ok(bought === total, `一键全买成交件数 == 库存总数（${bought} / ${total}）`);
    ok(g().gold === goldBefore - expectedCost, `花费与逐件折扣一致（实花 ${goldBefore - g().gold} == 预期 ${expectedCost}）`);
    ok(g().refreshCount === 1, `买空后触发免费刷新（refreshCount=${g().refreshCount}）`);
    ok(g().gold === goldBefore - expectedCost, '免费刷新不额外扣金币');
    ok(g().shopStock.equipment.length + g().shopStock.consumables.length > 0, '免费刷新后新库存非空');
    ok(
      g().inventory.length + g().consumables.length === total,
      `买走的装备/物品已入背包（${g().inventory.length} 装 + ${g().consumables.length} 物 = ${g().inventory.length + g().consumables.length}）`,
    );

    // 15b：金币只够部分 → 买得起的部分成交，余货保留、不触发刷新
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'novice');
    const e1 = generateEquipment(mulberry32(1), 'normal'); e1.basePrice = 10; e1.opened = true;
    const e2 = generateEquipment(mulberry32(2), 'normal'); e2.basePrice = 10; e2.opened = true;
    const e3 = generateEquipment(mulberry32(3), 'blue');   e3.basePrice = 100; e3.opened = true;
    useGame.setState({
      shopStock: { equipment: [e1, e2, e3], consumables: [] },
      gold: 25, tradeCount: 0, inventory: [], consumables: [],
    });
    const rcBefore = g().refreshCount;
    const boughtB = g().buyAllShop();
    ok(boughtB === 2, `金币只够 2 件 → 成交 2（${boughtB}）`);
    ok(g().refreshCount === rcBefore, '库存未清空 → 不触发刷新');
    ok(g().shopStock.equipment.length === 1 && g().shopStock.consumables.length === 0, '余货（蓝装）保留');

    // 15c：空商店 → 直接返回 0，不抛异常
    useGame.setState({ shopStock: { equipment: [], consumables: [] } });
    ok(g().buyAllShop() === 0, '空商店一键全买返回 0 且不抛异常');

    g().reset();
  }

  // ── v2.7 §1.3 一键全部装备 ────────────────────────────────
  console.log('\n[16] v2.7 §1.3：一键全部装备（评分排序 + 空槽优先）');
  {
    const mkEq = (seed: number, rarity: Rarity, basePrice = 30): Equipment => {
      const e = generateEquipment(mulberry32(seed), rarity);
      e.opened = true; e.basePrice = basePrice;
      return e;
    };

    // 16a：全队轮转 → 按评分发放，空槽最多者优先 → 各勇者件数均衡
    seedRandom(771001);
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'novice');
    const poolA = [
      mkEq(1, 'normal'), mkEq(2, 'normal'), mkEq(3, 'normal'),
      mkEq(4, 'blue'), mkEq(5, 'blue'), mkEq(6, 'orange'),
      mkEq(7, 'orange'), mkEq(8, 'red'), mkEq(9, 'red'),
    ];
    useGame.setState({ inventory: poolA, equipped: {}, tradeCount: 0 });
    const nA = poolA.length;
    const placedA = g().equipAll();
    ok(placedA === nA, `背包 ${nA} 件全部装备（${placedA}）`);
    ok(g().inventory.length === 0, '背包清空');
    const wornA = Object.values(g().equipped).flat();
    const idsA = wornA.map((e) => e.id);
    ok(new Set(idsA).size === idsA.length, '装备实例唯一（无重复上身）');
    const countsA = g().run.team.map((h) => (g().equipped[h.uid] ?? []).length);
    const maxA = Math.max(...countsA), minA = Math.min(...countsA);
    ok(maxA - minA <= 1, `空槽最多者优先 → 各勇者件数均衡（${countsA.join('/')}）`);
    // 最高分装备（红装）确实被穿上、且不在背包
    const bestA = [...poolA].sort((a, b) => equipScore(b) - equipScore(a))[0];
    ok(wornA.some((e) => e.id === bestA.id), '最高分装备已上场');
    ok(!g().inventory.some((e) => e.id === bestA.id), '最高分装备已离开背包');

    // 16b：只装备当前勇者（uid）→ 仅该勇者获得，其余不动
    seedRandom(771002);
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'novice');
    const poolB = [mkEq(11, 'normal'), mkEq(12, 'blue'), mkEq(13, 'orange'), mkEq(14, 'red')];
    useGame.setState({ inventory: poolB, equipped: {}, tradeCount: 0 });
    const heroB = g().run.team[0];
    const placedB = g().equipAll(heroB.uid);
    ok(placedB === 4, `单勇者一键装备 4 件（${placedB}）`);
    ok((g().equipped[heroB.uid] ?? []).length === 4, '目标勇者穿满 4 件');
    ok(g().run.team.slice(1).every((h) => (g().equipped[h.uid] ?? []).length === 0), '其余勇者未被装备');
    const bestB = [...poolB].sort((a, b) => equipScore(b) - equipScore(a))[0];
    ok((g().equipped[heroB.uid] ?? []).some((e) => e.id === bestB.id), '最高分装备给了该勇者');

    // 16c：槽位上限 6 → 单勇者最多穿 6，余货留背包
    seedRandom(771003);
    g().reset();
    g().startRun(HEROES.slice(0, 1), 'novice');
    const poolC = Array.from({ length: 10 }, (_, i) => mkEq(20 + i, 'normal'));
    useGame.setState({ inventory: poolC, equipped: {}, tradeCount: 0 });
    const heroC = g().run.team[0];
    const placedC = g().equipAll(heroC.uid);
    ok(placedC === 6, `单勇者最多穿 6 件（实际 ${placedC}）`);
    ok((g().equipped[heroC.uid] ?? []).length === 6, '勇者身上恰好 6 件');
    ok(g().inventory.length === 4, `剩余 4 件留在背包（${g().inventory.length}）`);

    g().reset();
  }

  // ── v2.7 §1.2 一键熔炼（属性转移非 100%）──────────────────
  console.log('\n[17] v2.7 §1.2：一键熔炼全部素材（属性转移非 100%、已穿戴保护）');
  {
    const mkEq = (id: string, rarity: Rarity, affixes: Affix[], basePrice = 10): Equipment => ({
      id, name: 't', rarity, affixes, opened: true, basePrice,
      ...(rarity === 'red' ? { star: 1 } : {}),
    });

    // 17a：背包内除核心装外的全部装备喂入 → 素材销毁、核心装留存
    seedRandom(772001);
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'novice');
    const target = mkEq('tg', 'blue', [{ key: 'hp', value: 10, mode: 'flat' }]);
    // 10 件普通素材，每条唯一且与核心装（hp）不冲突，成功即新增一条不同 key
    const matKeys: AffixKey[] = ['pDmg', 'mDmg', 'atkSpeed', 'crit', 'critDmg', 'pResist', 'mResist', 'moveSpeed', 'dodge', 'heal'];
    const mats = matKeys.map((k, i) => mkEq('mt' + i, 'normal', [{ key: k, value: 5, mode: 'flat' }]));
    useGame.setState({ inventory: [target, ...mats], equipped: {}, tradeCount: 0 });
    g().transferForgeAll(target.id);
    const inv17 = g().inventory;
    ok(inv17.length === 1 && inv17[0].id === target.id, '一键熔炼后仅核心装留存，其余素材全部销毁');
    ok(mats.every((m) => !inv17.some((e) => e.id === m.id)), '被熔素材已从背包彻底移除');
    const newKeys = inv17[0].affixes.filter((a) => a.key !== 'hp').map((a) => a.key);
    ok(new Set(newKeys).size < matKeys.length, `属性转移非 100%（成功 ${new Set(newKeys).size}/${matKeys.length}，普通素材单条 35%）`);

    // 17b：已穿戴装备不参与熔炼（天然保护，不会被烧掉）
    seedRandom(772002);
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'novice');
    const core = mkEq('core', 'blue', [{ key: 'hp', value: 10, mode: 'flat' }]);
    const inBag = mkEq('bag1', 'normal', [{ key: 'pDmg', value: 5, mode: 'flat' }]);
    const worn = mkEq('worn1', 'normal', [{ key: 'mDmg', value: 5, mode: 'flat' }]);
    const heroW = g().run.team[0];
    useGame.setState({
      inventory: [core, inBag],
      equipped: { [heroW.uid]: [worn] },
      tradeCount: 0,
    });
    g().transferForgeAll(core.id);
    const inv17b = g().inventory;
    ok(inv17b.some((e) => e.id === core.id), '核心装仍在背包');
    ok(!inv17b.some((e) => e.id === inBag.id), '背包内素材已熔（已从背包移除）');
    const stillWorn = g().equipped[heroW.uid]?.some((e) => e.id === worn.id);
    ok(stillWorn === true, '已穿戴装备未被熔炼，仍在原勇者身上');

    g().reset();
  }

  // ── v2.7 §3 5★ 突破：60% 主属性 / 40% 其余三项 ─────────────
  console.log('\n[18] v2.7 §3：5★ 突破 60% 主属性 / 40% 其余三项（且非固定雷同）');
  {
    ok(BREAKTHROUGH_MAIN_CHANCE === 0.6, `突破命中主属性概率常量为 0.6（实际 ${BREAKTHROUGH_MAIN_CHANCE}）`);

    // 18a：多份 5★ 副本各突破一次 → 主/其他分布大致 60/40，且两种结果都出现
    seedRandom(773001);
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'novice');
    const team = Array.from({ length: 40 }, (_, i) => {
      const base = HEROES[i % HEROES.length];
      return { ...base, uid: 'bt' + i, star: 5, bonusPct: {} as Partial<PrimaryAttrs>, dupIndex: i + 1 };
    });
    useGame.setState({ run: { ...g().run!, team }, gold: 1e9, tradeCount: 0 });

    let mainCnt = 0, otherCnt = 0;
    let keyOk = true, uidOk = true;
    for (const h of team) {
      g().upgradeHero(h.uid);
      const r = g().lastBreakthrough;
      if (!r) { keyOk = false; continue; }
      if (r.heroUid !== h.uid) uidOk = false;
      if (r.main) {
        mainCnt++;
        if (r.key !== dominantPrimary(h.basePrimary)) keyOk = false; // 命中主属性时 key 必为主属性
      } else {
        otherCnt++;
        const main = dominantPrimary(h.basePrimary);
        if (r.key === main || !PRIMARY_KEYS.includes(r.key as keyof PrimaryAttrs)) keyOk = false; // 其余三项之一
      }
    }
    const tot = mainCnt + otherCnt;
    ok(tot === 40, `40 份副本均完成一次突破（${tot}）`);
    ok(mainCnt > 0 && otherCnt > 0, `两种结果都出现（主 ${mainCnt} / 其他 ${otherCnt}）`);
    const frac = mainCnt / tot;
    ok(frac >= 0.40 && frac <= 0.80, `主属性命中占比约 60%（实测 ${(frac * 100).toFixed(0)}%，区间 40%–80%）`);
    ok(keyOk, 'key 取值正确：主属性命中=主属性，否则=其余三项之一');
    ok(uidOk, '回执 heroUid 与突破对象一致（同名多份不指错人）');

    // 18b：同层连点同一勇者 → 每次都是新一掷（修复旧版连点结果雷同的 bug）
    seedRandom(773002);
    g().reset();
    g().startRun(HEROES.slice(0, 1), 'novice');
    const one = { ...HEROES[0], uid: 'one', star: 5, bonusPct: {} as Partial<PrimaryAttrs>, dupIndex: 1 };
    useGame.setState({ run: { ...g().run!, team: [one] }, gold: 1e9, tradeCount: 0 });
    const adds: number[] = [];
    for (let i = 0; i < 12; i++) {
      g().upgradeHero('one');
      const r = g().lastBreakthrough;
      if (r) adds.push(r.add);
    }
    ok(new Set(adds).size >= 2, `同层连点突破每次加成各异（${new Set(adds).size} 种不同 add）`);
    const sumBonus = Math.round(Object.values(g().run!.team[0].bonusPct ?? {}).reduce((s, v) => s + (v ?? 0), 0) * 10) / 10;
    ok(sumBonus > 0, `12 次突破累积生效（累计加成 ${sumBonus}%）`);

    g().reset();
  }

  // ── v2.9.4：随机奇遇 + 精英 Boss 提示 + 休整屏三子页教学锚点 ─────────────
  console.log('\n[19] v2.9.4：随机奇遇（确定性 / 单次结算）+ 精英 Boss 标记 + 三子页教学锚点');
  {
    // 19a：事件抽取完全由 (layer, seed, mode) 决定 —— 同参数两次 genLayer 必须一致
    let evtLayers = 0;
    let sameOk = true;
    let bossClean = true;  // Boss 层不叠加事件
    let layer1Ok = true;   // 第 1 层留给教学，不出事件
    for (let L = 1; L <= 30; L++) {
      const a = genLayer(L, 20250401, 'endless');
      const b = genLayer(L, 20250401, 'endless');
      if (JSON.stringify(a.randomEvent ?? null) !== JSON.stringify(b.randomEvent ?? null)) sameOk = false;
      if (a.randomEvent) {
        evtLayers++;
        if (a.bossTier) bossClean = false;
        if (L === 1) layer1Ok = false;
      }
    }
    ok(sameOk, '同 (layer, seed, mode) 两次生成的奇遇完全一致（含选项与结果文案）');
    ok(evtLayers > 0 && evtLayers < 30, `30 层里 ${evtLayers} 层触发奇遇（非全触发、非全不触发）`);
    ok(bossClean, 'Boss 层不叠加奇遇（避免信息过载）');
    ok(layer1Ok, '第 1 层不出奇遇（留给教学）');

    // 19b：精英 Boss = 每 10 层的 Boss 层
    const elites: number[] = [];
    let eliteImpliesBoss = true;
    for (let L = 1; L <= 30; L++) {
      const p = genLayer(L, 20250401, 'endless');
      if (p.eliteBoss) {
        elites.push(L);
        if (!p.bossTier) eliteImpliesBoss = false;
      }
    }
    ok(elites.join(',') === '10,20,30', `精英 Boss 落在每 10 层（实际 ${elites.join(',') || '无'}）`);
    ok(eliteImpliesBoss, '精英 Boss 层必然同时是 Boss 层（bossTier 非空）');

    // 19c：奇遇结算一次生效、二次幂等；金币/背包按 effect 精确变化
    seedRandom(880019);
    g().reset();
    g().startRun(HEROES.slice(0, 3), 'endless');
    const runSeed = g().run!.seed;
    let hit = 0;
    for (let L = 2; L <= 40 && hit < 3; L++) {
      const ev = genLayer(L, runSeed, 'endless').randomEvent;
      if (!ev) continue;
      hit++;
      // 备足金币与素材，让「有代价的选项」真的能成交（空包 / 没钱会被门槛拦下，见 19e）
      const irng = mulberry32((90000 + L) >>> 0);
      useGame.setState({
        run: { ...g().run!, layer: L },
        gold: 5000,
        inventory: [generateEquipment(irng, 'normal'), generateEquipment(irng, 'blue')],
      });
      const idx = 0; // 首个选项通常是「有代价的那个」，最能暴露记账错误
      const e = ev.options[idx].effect;
      const goldBefore = g().gold;
      const invBefore = g().inventory.length;
      g().resolveRandomEvent(L, idx);
      ok(g().resolvedEvents.includes(L), `第 ${L} 层奇遇「${ev.title}」已记账（resolvedEvents）`);
      ok(g().gold === goldBefore + (e.gold ?? 0), `第 ${L} 层金币变化符合 effect（${e.gold ?? 0}）`);
      const expectInv = invBefore + (e.give?.count ?? 0) - (e.sacrificeLowest && invBefore > 0 ? 1 : 0);
      ok(g().inventory.length === expectInv, `第 ${L} 层背包件数符合 effect（${invBefore}→${g().inventory.length}）`);
      const gold2 = g().gold;
      const inv2 = g().inventory.length;
      g().resolveRandomEvent(L, 1);
      ok(g().gold === gold2 && g().inventory.length === inv2, `第 ${L} 层重复结算无效（同层只结算一次）`);
    }
    ok(hit >= 1, `至少覆盖到 1 次真实奇遇结算（实际 ${hit} 次）`);

    // 19d：越界层号 / 越界选项不得改变任何状态
    const safeGold = g().gold;
    const safeInv = g().inventory.length;
    g().resolveRandomEvent(9999, 0);
    g().resolveRandomEvent(g().run!.layer, 99);
    ok(g().gold === safeGold && g().inventory.length === safeInv, '越界层号 / 越界选项不改变状态（不崩、不刷金）');

    // 19e：经济闭环 —— 献祭必须真的付出装备、付费必须真的买得起（金币不为负）
    let sacrificeLayer = -1;
    let payLayer = -1;
    let payCost = 0;
    for (let L = 2; L <= 60 && (sacrificeLayer < 0 || payLayer < 0); L++) {
      const ev = genLayer(L, runSeed, 'endless').randomEvent;
      if (!ev) continue;
      if (sacrificeLayer < 0 && ev.options.some((o) => o.effect.sacrificeLowest)) sacrificeLayer = L;
      const pay = ev.options.find((o) => (o.effect.gold ?? 0) < 0 && !o.effect.sacrificeLowest);
      if (payLayer < 0 && pay) { payLayer = L; payCost = -(pay.effect.gold ?? 0); }
    }
    if (sacrificeLayer > 0) {
      useGame.setState({ run: { ...g().run!, layer: sacrificeLayer }, gold: 0, inventory: [], resolvedEvents: [] });
      const ev = genLayer(sacrificeLayer, runSeed, 'endless').randomEvent!;
      const idx = ev.options.findIndex((o) => o.effect.sacrificeLowest);
      g().resolveRandomEvent(sacrificeLayer, idx);
      ok(g().gold === 0 && !g().resolvedEvents.includes(sacrificeLayer), '空背包点献祭无效（不凭空印钱）');
    } else {
      ok(true, '本 seed 未抽到献祭类事件，跳过空包献祭校验');
    }
    if (payLayer > 0) {
      useGame.setState({ run: { ...g().run!, layer: payLayer }, gold: 0, inventory: [], resolvedEvents: [] });
      const ev = genLayer(payLayer, runSeed, 'endless').randomEvent!;
      const idx = ev.options.findIndex((o) => (o.effect.gold ?? 0) < 0 && !o.effect.sacrificeLowest);
      g().resolveRandomEvent(payLayer, idx);
      ok(g().gold === 0, `金币不足时付费选项不成交（需 ${payCost}，余额仍为 0）`);
    } else {
      ok(true, '本 seed 未抽到付费类事件，跳过余额校验');
    }

    // 19f：教学锚点契约 —— 三子页拆分后每个 anchorId 都要有明确归属（中枢页 / 子页 / 战前屏）
    const HUB_ANCHORS = ['tut-guide', 'tut-hero-panel', 'tut-hero-sell'];
    const TAB_ANCHORS = [
      'tut-equip', 'tut-inventory', 'tut-inventory-grid',
      'tut-forge', 'tut-forge-transfer', 'tut-forge-reroll', 'tut-fuse',
      'tut-shop', 'tut-shop-buy', 'tut-shop-buy-grid', 'tut-shop-refresh',
    ];
    const PRE_ANCHORS = ['tut-formation', 'tut-prebattle-start', 'tut-prebattle-skip'];
    const known = new Set([...HUB_ANCHORS, ...TAB_ANCHORS, ...PRE_ANCHORS]);
    const interAnchors = TUTORIAL.filter((grp) => grp.screen === 'inter').flatMap((grp) => grp.steps.map((s) => s.anchorId));
    const unknown = [...new Set(TUTORIAL.flatMap((grp) => grp.steps.map((s) => s.anchorId)))].filter((a) => !known.has(a));
    ok(unknown.length === 0, `教学锚点全部有归属（未知锚点：${unknown.join(',') || '无'}）`);
    ok(interAnchors.includes('tut-guide'), '「建议下一步」渐进引导教学点存在（tut-guide）');
    ok(
      interAnchors.some((a) => a === 'tut-fuse' || a.startsWith('tut-forge')) &&
      interAnchors.some((a) => a.startsWith('tut-shop')) &&
      interAnchors.includes('tut-inventory'),
      '穿戴 / 融合 / 商店 三套子页各自至少有 1 个教学点',
    );

    g().reset();
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}\n`);
  process.exit(fail === 0 ? 0 : 1);
