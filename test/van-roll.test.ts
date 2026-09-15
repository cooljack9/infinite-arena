// v2.9.x 特殊关加权抽取 + 面包车车队编成回归测试
//
// 这个文件存在的理由，是先把「坏掉长什么样」写下来，再谈实现对不对。
// 需求给的是一张概率表（疯狂龙巢 7% / 八角笼 7% / 面包车 7% / 普通 79%），
// 概率表最容易坏的方式恰恰是**没人发现它坏了**——出现率从 7% 漂到 3%，
// 玩家只会觉得「好久没见过面包车了」，不会开 issue，而 CI 全绿。
//
// 所以这里钉死四类失败信号：
//   A) 权重漂移：任一特殊关实测频率偏离 7% 超过容差 → 表被改坏或被列表长度污染
//   B) 边界泄漏：新手模式 / 前 2 层出现特殊关 → 教学期归因被随机性毁掉
//   C) 编成失控：面包人总数回到 16~80 的 5 倍方差，或每车人数越出需求的 4~10
//   D) 池子污染：面包车/面包人漏进普通波次抽取池（e_van 出现在非车队关）
import { describe, it, expect } from 'vitest';
import { genLayer } from '../packages/core/src/gen/levelGen';
import { ENEMIES_BY_CAT, VAN_CFG } from '../packages/core/src/content/enemies';

// 采样量：3000 层 × 二项分布，p=0.07 的标准差 ≈ 0.0047，
// ±0.02 的容差 ≈ 4σ —— 真实漂移抓得住，随机波动不误报。
const N = 3000;
const TOL = 0.02;

function sampleArenas(count: number, opts: { mode?: 'novice'; layerFrom: number }) {
  const tally = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    // 层数与 seed 同时变：只变 seed 会把 bossTier 钉死在同一相位，
    // 抽出来的是「某一类层」的分布而不是全局分布。
    const layer = opts.layerFrom + (i % 30);
    const plan = genLayer(layer, 1000 + i * 13, opts.mode);
    tally.set(plan.arena.id, (tally.get(plan.arena.id) ?? 0) + 1);
  }
  return tally;
}

describe('v2.9.x 特殊关加权抽取（A 权重漂移）', () => {
  const tally = sampleArenas(N, { layerFrom: 3 });
  const freq = (id: string) => (tally.get(id) ?? 0) / N;

  it('疯狂龙巢 ≈ 7%', () => {
    expect(Math.abs(freq('DRAGON') - 0.07)).toBeLessThan(TOL);
  });

  it('八角笼 ≈ 7%', () => {
    expect(Math.abs(freq('CAGE') - 0.07)).toBeLessThan(TOL);
  });

  it('面包车 ≈ 7%', () => {
    expect(Math.abs(freq('VAN') - 0.07)).toBeLessThan(TOL);
  });

  it('普通关 ≈ 79%（三种特殊关之外的全部图共享）', () => {
    const special = freq('DRAGON') + freq('CAGE') + freq('VAN');
    expect(Math.abs((1 - special) - 0.79)).toBeLessThan(TOL);
  });

  it('出现率与 ARENA_LIST 长度解耦：普通图内部仍有多样性（≥3 种）', () => {
    // 这一条防的是「把 79% 全塞给一张图」——普通关变成同一张图刷 79%，
    // 概率表数字对了，体验却退化成单图循环。
    const normals = [...tally.keys()].filter((k) => !['DRAGON', 'CAGE', 'VAN'].includes(k));
    expect(normals.length).toBeGreaterThanOrEqual(3);
  });
});

describe('v2.9.x 特殊关边界（B 边界泄漏）', () => {
  it('新手模式：全程不出任何特殊关', () => {
    const tally = sampleArenas(600, { mode: 'novice', layerFrom: 1 });
    expect(tally.get('DRAGON') ?? 0).toBe(0);
    expect(tally.get('CAGE') ?? 0).toBe(0);
    expect(tally.get('VAN') ?? 0).toBe(0);
  });

  it('第 1~2 层：不出任何特殊关（玩家还没建立基线手感，此时随机=劝退）', () => {
    for (let seed = 0; seed < 400; seed++) {
      for (const layer of [1, 2]) {
        const id = genLayer(layer, seed * 7 + 3).arena.id;
        expect(['DRAGON', 'CAGE', 'VAN']).not.toContain(id);
      }
    }
  });

  it('同 seed 同层必然同图（确定性没被加权抽取破坏）', () => {
    for (let seed = 0; seed < 50; seed++) {
      const a = genLayer(7, seed);
      const b = genLayer(7, seed);
      expect(a.arena.id).toBe(b.arena.id);
      expect(a.vanEncounter).toEqual(b.vanEncounter);
    }
  });
});

describe('v2.9.x 面包车车队编成（C 编成失控）', () => {
  const plans = [];
  for (let seed = 0; seed < 20000 && plans.length < 300; seed++) {
    const p = genLayer(5 + (seed % 30), seed * 3 + 1);
    if (p.vanEncounter) plans.push(p);
  }

  it('样本足够（车队关能被抽到）', () => {
    expect(plans.length).toBeGreaterThan(100);
  });

  it('车数落在需求原文的 4~8', () => {
    for (const p of plans) {
      expect(p.vanEncounter!.vanCount).toBeGreaterThanOrEqual(4);
      expect(p.vanEncounter!.vanCount).toBeLessThanOrEqual(8);
    }
  });

  it('每车人数落在需求原文的 4~10', () => {
    for (const p of plans) {
      expect(p.vanEncounter!.peoplePerVan).toBeGreaterThanOrEqual(4);
      expect(p.vanEncounter!.peoplePerVan).toBeLessThanOrEqual(10);
    }
  });

  it('总人数方差被压住：不回到 16~80 的 5 倍抽奖', () => {
    const totals = plans.map((p) => p.vanEncounter!.vanCount * p.vanEncounter!.peoplePerVan);
    const lo = Math.min(...totals), hi = Math.max(...totals);
    // 允许比目标区间略宽（夹到 4~10 时会溢出一点），但 hi/lo 必须远小于 5
    expect(hi / lo).toBeLessThan(2.2);
    expect(lo).toBeGreaterThanOrEqual(20);
    expect(hi).toBeLessThanOrEqual(56);
  });

  it('车数与每车人数反相关：车多则每车人少（观感多样但难度可比）', () => {
    const few = plans.filter((p) => p.vanEncounter!.vanCount <= 5);
    const many = plans.filter((p) => p.vanEncounter!.vanCount >= 7);
    const avg = (xs: typeof plans) => xs.reduce((s, p) => s + p.vanEncounter!.peoplePerVan, 0) / xs.length;
    expect(avg(few)).toBeGreaterThan(avg(many));
  });

  it('wave 0 = 全部面包车；不叠常规小怪波；不放建筑', () => {
    for (const p of plans) {
      const ve = p.vanEncounter!;
      expect(p.waves[0].length).toBe(ve.vanCount);
      expect(p.waves[0].every((e) => e.id === 'e_van')).toBe(true);
      // 非 Boss 层只有车队一波；Boss 层额外保留 Boss 波
      expect(p.waves.length).toBe(p.bossTier ? 2 : 1);
      if (p.bossTier) expect(p.waves[1].every((e) => e.isBoss)).toBe(true);
      expect(p.buildings.length).toBe(0);
    }
  });

  it('下人节奏与同屏上限被带进 LayerPlan（前后端同读一份配置）', () => {
    for (const p of plans) {
      expect(p.vanEncounter!.dropInterval).toBe(VAN_CFG.dropInterval);
      expect(p.vanEncounter!.concurrentPeopleCap).toBe(VAN_CFG.concurrentPeopleCap);
      expect(p.vanEncounter!.openingBuffSec).toBe(10);
      expect(p.vanEncounter!.personPrimaryMul).toBe(0.5);
      expect(p.vanEncounter!.personMoveSpeedAdd).toBe(30);
      expect(p.vanEncounter!.personAtkSpeedAdd).toBe(50);
    }
  });
});

describe('v2.9.x 面包车不污染普通抽取池（D 池子污染）', () => {
  it('ENEMIES_BY_CAT 各类目均不含 e_van / e_van_person', () => {
    for (const cat of ['tank', 'warrior', 'archer', 'mage']) {
      const ids = ENEMIES_BY_CAT(cat).map((e) => e.id);
      expect(ids).not.toContain('e_van');
      expect(ids).not.toContain('e_van_person');
    }
  });

  it('非车队关的波次里不会出现面包车（否则普通层凭空开车）', () => {
    for (let seed = 0; seed < 500; seed++) {
      const p = genLayer(4 + (seed % 40), seed * 11 + 5);
      if (p.vanEncounter) continue;
      for (const wave of p.waves) {
        for (const e of wave) {
          expect(e.id).not.toBe('e_van');
          expect(e.id).not.toBe('e_van_person');
        }
      }
    }
  });
});
