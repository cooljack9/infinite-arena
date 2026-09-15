// 反"堆一人"·轻量方案验证（敌方针对最强角色的被动）。
//
// 根因：战斗引擎偏好「集中」——敌人不针对最强时，一个神装单体天然能 solo。
// 旧 stat 机制（协同系数 / 战力上限）实测压不住：同总战力下堆人队仍稳赢
// （伤害随浓度非线性膨胀）。改用轻量结构方案：敌人按层调度、低频给部分敌人
// 打「针对最强」被动标记——前排敌死亡同归于尽带走最强、后排敌施法捆仙绳封印最强。
//
// 本文件验证纯函数与机制接线：
//   · applyEnemyFocus：按层调度打标（浅层无、深层低频、召唤物/Boss 跳过；vX 起不区分队伍集中度）
//   · findStrongestAlly：定向惩罚的判定基础
//   · 配置接入：overrideEnemyFocus → getEnemyFocus 生效
//   · 机制接线：同归于尽真的带走人；捆仙绳真的封印双方且死亡即解除
//
// vX 变更（用户需求「不需要回避均衡队」）：删除了集中度闸门 concentration / focusGate。
// 现在均衡队与堆一人队走同一套 applyEnemyFocus 逻辑——都会按 applyChance 被打标，
// 因此均衡队也会遇到死士（同归于尽 / 捆仙绳）。下方测试已对应该行为。
import { describe, it, expect } from 'vitest';
import { BattleSim } from '../packages/core/src/engine/battle';
import {
  applyEnemyFocus, findStrongestAlly,
  getEnemyFocus, overrideEnemyFocus, ENEMY_FOCUS_DEFAULT,
} from '../packages/core/src/engine/coherence';
import { ARENAS } from '../packages/core/src/content/arenas';
import { mulberry32 } from '../packages/core/src/engine/rng';

function fakeUnit(side: 'ally' | 'enemy', subclass: any, opts: any = {}): any {
  return {
    id: `${side}-${Math.random().toString(36).slice(2, 8)}`,
    name: side, side, subclass, alive: true, isSummon: false, isBoss: false,
    x: 0, y: 0, hitRadius: 0.5, hp: 100, maxHp: 100,
    derived: {
      pDmg: 0, mDmg: 0, hp: 100, moveSpeed: 1, atkSpeed: 100, crit: 0, critDmg: 150,
      dodge: 0, regenPct: 0, pResist: 0, mResist: 0, heal: 0, dmgTakenMult: 1, shield: 0,
    },
    skill: { id: 'none', name: '', cd: 5, damageType: 'physical', desc: '' },
    skillCd: 0, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0, dmgMult: 1, level: 1,
    ...opts,
  };
}
function resetCfg() { overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT }); }

/** 堆一人队（一个 ACE 远高于其余两人） */
const stackTeam = () => [
  fakeUnit('ally', 'gunner', { name: 'ACE', derived: { pDmg: 300, mDmg: 0, hp: 100 } }),
  fakeUnit('ally', 'gunner', { derived: { pDmg: 30, mDmg: 0, hp: 100 } }),
  fakeUnit('ally', 'gunner', { derived: { pDmg: 30, mDmg: 0, hp: 100 } }),
];
/** 均衡队（三人战力相等） */
const evenTeam = () => [0, 1, 2].map(() =>
  fakeUnit('ally', 'gunner', { derived: { pDmg: 100, mDmg: 0, hp: 100 } }));

describe('applyEnemyFocus：按层调度打标（不区分队伍集中度）', () => {
  it('浅层（< onsetFloor）不打标', () => {
    resetCfg();
    const units = [...stackTeam(), fakeUnit('enemy', 'physTank'), fakeUnit('enemy', 'gunner')];
    applyEnemyFocus(units, 1, mulberry32(1));
    expect(units.every((u: any) => !u.focusRole)).toBe(true);
  });

  it('vX：均衡队也按 applyChance 被打标（不再回避均衡队）', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, applyChance: 1 });
    const front = fakeUnit('enemy', 'physTank'); // 射程近 → front
    const back = fakeUnit('enemy', 'gunner');    // 射程 5.0 → back
    applyEnemyFocus([...evenTeam(), front, back], 10, mulberry32(0));
    expect(front.focusRole).toBe('front');
    expect(back.focusRole).toBe('back');
    resetCfg();
  });

  it('深层 + 堆一人：同样按 applyChance 打标（两种队伍走同一逻辑）', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, applyChance: 1 });
    const front = fakeUnit('enemy', 'physTank');
    const back = fakeUnit('enemy', 'gunner');
    applyEnemyFocus([...stackTeam(), front, back], 10, mulberry32(0));
    expect(front.focusRole).toBe('front');
    expect(back.focusRole).toBe('back');
    resetCfg();
  });

  it('同 seed 打标结果逐 bit 一致（确定性，不破坏回放/parity）', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, applyChance: 1 });
    const mk = () => [fakeUnit('enemy', 'physTank'), fakeUnit('enemy', 'gunner'), fakeUnit('enemy', 'sniper')];
    const u1 = mk(); applyEnemyFocus(u1, 10, mulberry32(123));
    const u2 = mk(); applyEnemyFocus(u2, 10, mulberry32(123));
    expect(u1.map((u) => u.focusRole)).toEqual(u2.map((u) => u.focusRole));
    resetCfg();
  });

  it('召唤物 / Boss 不打标', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, applyChance: 1 });
    const sum = fakeUnit('enemy', 'summoner', { isSummon: true });
    const boss = fakeUnit('enemy', 'physTank', { isBoss: true });
    applyEnemyFocus([...stackTeam(), sum, boss], 10, mulberry32(0));
    expect(sum.focusRole).toBeUndefined();
    expect(boss.focusRole).toBeUndefined();
    resetCfg();
  });
});

describe('findStrongestAlly', () => {
  const mk = (pDmg: number, extra: any = {}) =>
    fakeUnit('ally', 'gunner', { derived: { pDmg, mDmg: 0, hp: 100 }, ...extra });

  it('排除死亡英雄，返回战力最高者', () => {
    const a = mk(999); const b = mk(50);
    const dead = mk(9999, { alive: false });
    expect(findStrongestAlly([a, b, dead])).toBe(a);
  });
});

describe('配置接入', () => {
  it('overrideEnemyFocus 改变 getEnemyFocus 返回值', () => {
    overrideEnemyFocus({ onsetFloor: 99 });
    expect(getEnemyFocus().onsetFloor).toBe(99);
    resetCfg();
  });
});

describe('机制接线：同归于尽', () => {
  it('front 标记敌死亡 → 满血的最强 ally 被直接带走', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, frontMutualP: 1 });
    const a = fakeUnit('ally', 'gunner', { name: 'ACE', derived: { pDmg: 300, mDmg: 0, hp: 100 } });
    const b = fakeUnit('ally', 'gunner', { derived: { pDmg: 30, mDmg: 0, hp: 100 } });
    const c = fakeUnit('ally', 'gunner', { derived: { pDmg: 30, mDmg: 0, hp: 100 } });
    // hp 必须为 0：killIfDown 的语义是「已经倒下就结算」，活着的敌人不会触发死亡分支
    const frontEnemy = fakeUnit('enemy', 'physTank', { focusRole: 'front', hp: 0 });
    const sim = new BattleSim([a, b, c, frontEnemy], ARENAS.A1, 1);
    (sim as any).killIfDown(frontEnemy, undefined);
    expect(a.alive).toBe(false); // 满血也被带走（清盾清血 → 真死）
    expect(b.alive).toBe(true);  // 只带最强那个
    resetCfg();
  });

  it('vX：均衡队也会触发同归于尽（标记不再回避均衡队）', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, frontMutualP: 1 });
    const a = fakeUnit('ally', 'gunner', { derived: { pDmg: 100, mDmg: 0, hp: 100 } });
    const b = fakeUnit('ally', 'gunner', { derived: { pDmg: 100, mDmg: 0, hp: 100 } });
    const c = fakeUnit('ally', 'gunner', { derived: { pDmg: 100, mDmg: 0, hp: 100 } });
    const frontEnemy = fakeUnit('enemy', 'physTank', { focusRole: 'front', hp: 0 });
    const sim = new BattleSim([a, b, c, frontEnemy], ARENAS.A1, 1);
    (sim as any).killIfDown(frontEnemy, undefined);
    // 均衡队同样会被死士带走最强英雄（三人战力相等 → findStrongestAlly 取首个 a）
    expect(a.alive).toBe(false);
    expect(b.alive && c.alive).toBe(true);
    resetCfg();
  });
});

describe('机制接线：捆仙绳', () => {
  const mkTeam = () => [
    fakeUnit('ally', 'gunner', { name: 'ACE', derived: { pDmg: 300, mDmg: 0, hp: 100 } }),
    fakeUnit('ally', 'gunner', { derived: { pDmg: 30, mDmg: 0, hp: 100 } }),
    fakeUnit('ally', 'gunner', { derived: { pDmg: 30, mDmg: 0, hp: 100 } }),
  ];

  it('back 标记敌施法 → 双方同时被封印（stun，不只是 root）', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, backShackleP: 1, backShackleT: 8 });
    const [a, b, c] = mkTeam();
    const caster = fakeUnit('enemy', 'gunner', { focusRole: 'back' });
    const sim = new BattleSim([a, b, c, caster], ARENAS.A1, 1);
    (sim as any).castSkill(caster);
    // stun 才能真正让人「不能动也不能出手」——本引擎 root 只挡移动
    expect(a.stunUntil).toBeGreaterThan(0);
    expect(caster.stunUntil).toBeGreaterThan(0);
    expect(a.shackleWith).toBe(caster.id);
    expect(caster.shackleWith).toBe(a.id);
    expect(b.stunUntil).toBe(0); // 只锁最强
    resetCfg();
  });

  it('施法怪被击杀 → 被封印的英雄立刻挣脱', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, backShackleP: 1, backShackleT: 8 });
    const [a, b, c] = mkTeam();
    const caster = fakeUnit('enemy', 'gunner', { focusRole: 'back' });
    const sim = new BattleSim([a, b, c, caster], ARENAS.A1, 1);
    (sim as any).castSkill(caster);
    expect(a.stunUntil).toBeGreaterThan(0);
    caster.hp = 0;
    (sim as any).killIfDown(caster, b);
    expect(a.stunUntil).toBeLessThanOrEqual((sim as any).time); // 封印解除
    expect(a.shackleWith).toBeUndefined();
    resetCfg();
  });

  it('每场只触发 maxBackPerBattle 次', () => {
    overrideEnemyFocus({ ...ENEMY_FOCUS_DEFAULT, onsetFloor: 1, backShackleP: 1, maxBackPerBattle: 1 });
    const [a, b, c] = mkTeam();
    const c1 = fakeUnit('enemy', 'gunner', { focusRole: 'back' });
    const c2 = fakeUnit('enemy', 'gunner', { focusRole: 'back' });
    const sim = new BattleSim([a, b, c, c1, c2], ARENAS.A1, 1);
    (sim as any).castSkill(c1);
    (sim as any).castSkill(c2);
    expect(c2.shackleWith).toBeUndefined();
    resetCfg();
  });
});
