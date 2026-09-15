// v1.8.2 线上可观测性修复 —— **parity / 终态** 回归。
//
// #2b 的核心承诺：云端 startBattle 返回 replay 包，前端本地 replayBattle 复现，
// 其 checksum 必须与服务端 runBattle 权威 checksum 逐 bit 相等（否则前后端引擎分裂）。
// 这条不变式一旦破坏，前端 ackBattle 回传的 client_checksum 就永远对不上，
// 线上「引擎漂移」监测（battles.client_checksum）形同虚设——这正是生产全空的根因。
import { describe, it, expect } from 'vitest';
import { createRun, advanceLayerTo, runBattle, replayBattle } from '../packages/core/src/rules';
import type { RunSnapshot } from '../packages/core/src/contract';

/**
 * replay 包装配。**必须与 LocalBackend / Edge Function 的装配字段集一字不差**。
 *
 * 之前这段是每个用例里手抄一遍的字面量，`vanEncounter` 加进契约后没人抄到测试里，
 * 而 5 个固定用例恰好都没落在车队关 → 测试继续全绿，漏配零成本通过。
 * 这就是"静止的面包车"能上线的路径：不是有人写错，是没人被逼着写对。
 * 抽成一个函数后，契约加字段时只有一处要改，且下面的车队关用例会立刻打红。
 */
function packReplay(data: any, layer: number) {
  return {
    allies: data.allies,
    enemies: data.enemies,
    arena: data.arena,
    buildings: data.buildings,
    layer,
    battleSeed: data.battleSeed,
    buildingScale: data.buildingScale,
    vanEncounter: data.vanEncounter,
  };
}

/**
 * 造一个推到指定层的对局快照。
 *
 * ⚠️ 这里原来循环调 `advanceLayer(snap)` —— 而 `advanceLayer` 只 `version + 1`，**不改 layer**
 * （推层是 `advanceLayerTo` 的活）。结果是下面写着 layer=1/5/12/20/30 的五个用例，
 * 实际全部在跑第 1 层：同一张图、同一批小怪、同一个 checksum 路径，测了五遍。
 * 这类"绿着的假覆盖"比红灯危险——它让人以为深层回放被验过了。
 * 车队关（层 ≥3 才出）正是被这一行挡在测试之外的，所以顺手在这次一起修。
 */
function runAt(seed: number, layer: number): RunSnapshot {
  const r = createRun({
    runId: `p_${seed}_${layer}`, seed,
    heroIds: ['h_physTank', 'h_charge', 'h_healer'],
    mode: 'normal', endlessUnlocked: true,
  });
  if (!r.ok) throw new Error('createRun 失败');
  const adv = advanceLayerTo(r.data, layer);
  if (!adv.ok) throw new Error(`advanceLayerTo(${layer}) 失败`);
  return adv.data;
}

describe('parity: replayBattle 复算 checksum == runBattle 权威 checksum（#2b 基石）', () => {
  const cases: [number, number][] = [
    [1, 1], [20250601, 5], [0xdeadbeef, 12], [777, 20], [42, 30],
  ];
  for (const [seed, layer] of cases) {
    it(`seed=${seed} layer=${layer}`, () => {
      const snap = runAt(seed, layer);
      const b = runBattle(snap, { seed }, {}, undefined);
      expect(b.ok, 'runBattle 应成功').toBe(true);
      const data = b.data;
      const replay = packReplay(data, snap.layer);
      const rep = replayBattle(replay);
      // ★ 关键不变式：两端逐 bit 一致
      expect(rep.checksum, 'checksum 必须相等').toBe(data.checksum);
      expect(rep.result, '胜负必须一致').toBe(data.result);
    });
  }

  it('负向：篡改 replay 任一字段 → checksum 必变（证明测试真在比对过程，而非恒等）', () => {
    const snap = runAt(20250601, 8);
    const b = runBattle(snap, { seed: 20250601 }, {}, undefined);
    const data = b.data;
    const replay = packReplay(data, snap.layer);
    const base = replayBattle(replay).checksum;
    // 改一个友方的当前血量
    const tampered = JSON.parse(JSON.stringify(replay));
    tampered.allies[0].hp += 1;
    const after = replayBattle(tampered).checksum;
    expect(after, '篡改后 checksum 应不同').not.toBe(base);
  });
});

// ── v2.9.x 车队关 parity ─────────────────────────────────────────────
//
// 车队关是当前唯一"配置在 replay 包里、行为在引擎里"的关卡：allies/enemies 里
// 只有一堆面包车单位，"什么时候踩油门、什么时候下人"全靠 vanEncounter 这一个字段。
// 漏配它不会报错——车照样在场上，只是不动、不撞、不下人，而 checksum 会安静地分叉。
// 所以这里必须有一个"落在车队关的具体 seed"，光靠 5 个通用用例是抓不到的。
describe('parity: 车队关（vanEncounter 必须随 replay travel）', () => {
  /** 扫出第一个落在 VAN 场地的 (seed, layer)。7% 概率 + 层≥3，扫百来次足够。 */
  function findVanCase(): { snap: RunSnapshot; seed: number } {
    for (let seed = 1; seed <= 400; seed++) {
      for (let layer = 3; layer <= 8; layer++) {
        const snap = runAt(seed, layer);
        const b = runBattle(snap, { seed }, {}, undefined);
        if (!b.ok) continue;
        if (b.data.arena.id === 'VAN') return { snap, seed };
      }
    }
    throw new Error('扫 400 seed × 6 层没抽到车队关——概率表被改坏了，去看 levelGen');
  }

  const found = findVanCase();

  it(`能抽到车队关（seed=${found.seed} layer=${found.snap.layer}），且 vanEncounter 随包下发`, () => {
    const b = runBattle(found.snap, { seed: found.seed }, {}, undefined);
    expect(b.ok).toBe(true);
    const ve = b.data.vanEncounter;
    expect(ve, 'VAN 场地必须带 vanEncounter，否则前端拿不到车队脚本').toBeTruthy();
    expect(ve!.vanCount).toBeGreaterThanOrEqual(4);
    expect(ve!.vanCount).toBeLessThanOrEqual(8);
    // 敌方开局单位应当全是面包车（车队关不混普通怪，Boss 层例外）
    const vans = b.data.enemies.filter((u: any) => u.monsterKind === 'van');
    expect(vans.length, '开局敌人里的面包车数应等于 vanCount').toBe(ve!.vanCount);
  });

  it('replay 复算 checksum 相等（带 vanEncounter）', () => {
    const b = runBattle(found.snap, { seed: found.seed }, {}, undefined);
    const rep = replayBattle(packReplay(b.data, found.snap.layer));
    expect(rep.checksum, '车队关也必须逐 bit 一致').toBe(b.data.checksum);
    expect(rep.result).toBe(b.data.result);
  });

  it('★负向：replay 漏配 vanEncounter → checksum 必变（证明字段是承重墙，不是装饰）', () => {
    const b = runBattle(found.snap, { seed: found.seed }, {}, undefined);
    const full = packReplay(b.data, found.snap.layer);
    const withVan = replayBattle(full).checksum;
    const withoutVan = replayBattle({ ...full, vanEncounter: undefined }).checksum;
    expect(withoutVan, '漏配 vanEncounter 竟然算出同一个 checksum —— 说明车队脚本根本没接上引擎').not.toBe(withVan);
  });

  it('车队真的下了人：战斗过程中出现过 van_person（不是"静止的面包车"）', () => {
    const b = runBattle(found.snap, { seed: found.seed }, {}, undefined);
    const rep = replayBattle(packReplay(b.data, found.snap.layer));
    const persons = rep.sim.units.filter((u: any) => u.monsterKind === 'van_person');
    expect(persons.length, '一辆车都没下人 → 撞击/下人时序断了').toBeGreaterThan(0);
    // 并发上限：同时在场的人数不该超过配置帽（这里用总生成数作宽松上限校验）
    expect(persons.length).toBeLessThanOrEqual(b.data.vanEncounter!.vanCount * b.data.vanEncounter!.peoplePerVan);
  });
});
