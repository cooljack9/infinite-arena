// 遭遇编排（需求 4.4.3 / 开发 §7）。生成敌方波次模板
import { EnemyDef } from '../types';
import { ENEMIES_BY_CAT, STRONG_BOSSES, NORMAL_BOSSES } from '../content/enemies';
import { RNG, pick } from '../engine/rng';

const CATS = ['tank', 'warrior', 'archer', 'mage'] as const;

export function buildWaves(
  rng: RNG,
  n: number,
  bossTier?: 'strong' | 'normal',
): EnemyDef[][] {
  const waveCount = n <= 10 ? 1 : n <= 30 ? 2 : 3;
  const waves: EnemyDef[][] = [];
  for (let w = 0; w < waveCount; w++) {
    const count = Math.min(8, 2 + Math.floor(n / 5) + (w > 0 ? 1 : 0));
    const wave: EnemyDef[] = [];
    for (let i = 0; i < count; i++) {
      const cat = pick(rng, CATS as unknown as string[]);
      const pool = ENEMIES_BY_CAT(cat as any);
      wave.push(pick(rng, pool));
    }
    waves.push(wave);
  }
  // v2.4 Boss 密度：普通 Boss（colossal）每 3 关，强力 Boss（titan）每 5 关
  if (bossTier) waves.push([pick(rng, bossTier === 'strong' ? STRONG_BOSSES : NORMAL_BOSSES)]);
  return waves;
}
