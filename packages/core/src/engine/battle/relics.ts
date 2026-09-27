// 遗物修正（应用到全部友方单位，开发 §5.7 / 需求 5.6）
// 从 battle.ts 抽出为独立模块，保持对外签名不变（由 battle.ts 再导出）。
import type { Unit, RelicDef } from '../../types';

export function applyRelics(units: Unit[], relics: RelicDef[]) {
  for (const r of relics) {
    const mod = r.mod;
    if (!mod) continue;
    for (const u of units) {
      if (u.side !== 'ally') continue;
      if (mod.dmgMult) u.dmgMult *= mod.dmgMult;
      if (mod.hpMult) {
        u.derived.hp = Math.round(u.derived.hp * mod.hpMult);
        u.maxHp = u.derived.hp; u.hp = u.derived.hp;
      }
      for (const k of Object.keys(mod) as Array<keyof typeof mod>) {
        if (k === 'dmgMult' || k === 'hpMult') continue;
        const val = mod[k];
        if (typeof val === 'number' && k in u.derived) {
          (u.derived as any)[k] += val;
        }
      }
    }
  }
  // v2.6.1：此处**不再**归一暴击软上限。旧实现把这个循环写在 for 之外 ——
  // 即使一个遗物都没带也会执行一遍，且 applyCritSoftCap 不幂等，后续天气/末端再归一
  // 会把爆伤反复压缩蒸发。统一放到 BattleSim 构造末端归一一次（体检报告 P1-1）。
}
