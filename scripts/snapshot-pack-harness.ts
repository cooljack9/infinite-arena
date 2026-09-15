// verify-snapshot-packing.mjs 的 TS 侧测试床（经 esbuild 打包后以 ESM 导入）。
// 用核心引擎造一局真实战斗，逐步推进，校验 packUnit 在任意 tick 对任意单位都能产出
// 含全部 UNIT_FIELDS 的精简对象，且必填数值字段为有限数 —— 防止漏打包导致运行时视觉回归。
import { BattleSim } from '../packages/core/src/engine/battle';
import { makeAlly, makeEnemy } from '../packages/core/src/engine/unit';
import { HEROES } from '../packages/core/src/content/heroes';
import { ARENAS, parseSpawns } from '../packages/core/src/content/arenas';
import { buildWaves } from '../packages/core/src/gen/encounter';
import { mulberry32 } from '../packages/core/src/engine/rng';
import { enemyScale } from '../packages/core/src/engine/scaling';
import { UNIT_FIELDS, packUnit } from '../src/render/packSurface';

export interface PackCheckResult {
  ok: boolean;
  errors: string[];
  ticks: number;
  unitCount: number;
}

export function runPackCheck(): PackCheckResult {
  const arena = ARENAS.A1;
  const spawns = parseSpawns(arena);
  const rng = mulberry32(20250815);
  const layer = 8;
  const sc = enemyScale(layer);

  // 取三个英雄（奶妈/坦克/输出），尽量覆盖召唤/坐骑/特性等形态
  const allyHeroes = Object.values(HEROES).slice(0, 3);
  const allies = allyHeroes.map((h, k) => {
    const u = makeAlly(h, 5 + layer, []);
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

  const sim = new BattleSim([...allies, ...enemies], arena, 20250815);

  const errors: string[] = [];
  const fields = UNIT_FIELDS as readonly string[];
  let ticks = 0;
  for (let i = 0; i < 600 && !sim.over; i++) {
    sim.tick(1 / 20);
    ticks++;
    const packed = sim.units.map(packUnit);
    for (const pu of packed) {
      for (const f of fields) {
        if (!(f in pu)) errors.push(`tick ${i}: 精简 Unit 缺少字段 "${f}"`);
      }
    }
    sim.drainAudioCues();
  }

  // 必填数值字段抽样校验（首个单位）
  const sample = sim.units.length ? packUnit(sim.units[0]) : null;
  if (sample) {
    for (const f of ['x', 'y', 'hp', 'maxHp', 'shield', 'hitRadius'] as const) {
      const v = (sample as Record<string, unknown>)[f];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`字段 "${f}" 非有限数: ${String(v)}`);
      }
    }
  }

  return { ok: errors.length === 0, errors: errors.slice(0, 30), ticks, unitCount: sim.units.length };
}
