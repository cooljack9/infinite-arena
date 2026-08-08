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
}
