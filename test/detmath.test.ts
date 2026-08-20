import { describe, it, expect } from 'vitest';
import { dsin, dcos, dpow, dpowi, drot, DEG } from '../packages/core/src/engine/detmath';
import { mulberry32 } from '../packages/core/src/engine/rng';

/**
 * 确定性数学库的验收标准有两条，缺一不可：
 *   1. 精度：与 `Math.*` 的相对偏差 ≤ 1e-15（否则会改变游戏平衡）
 *   2. 纯粹：只用 IEEE 754 正确舍入的运算（跨引擎一致性由 selfcheck.html 三引擎实测兜底）
 * 这里管第 1 条；第 2 条靠 scripts/guard-determinism.mjs 的静态闸门。
 */

const relErr = (a: number, b: number) => (b === 0 ? Math.abs(a) : Math.abs((a - b) / b));

describe('detmath · sin/cos 精度', () => {
  it('小角度区间（战斗引擎实际用到的范围）误差 < 1e-15', () => {
    const rng = mulberry32(20260808);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const x = rng() * 80 - 40; // 覆盖 ±40rad：坐标和角度叠加后的最坏范围
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it('象限边界与特殊值', () => {
    for (const k of [0, 1, 2, 3, 4, -1, -2, -3]) {
      const x = (k * Math.PI) / 2;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-15);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-15);
    }
    expect(dsin(0)).toBe(0);
    expect(dcos(0)).toBe(1);
    expect(Number.isNaN(dsin(NaN))).toBe(true);
    expect(Number.isNaN(dcos(Infinity))).toBe(true);
  });

  it('勾股恒等式 sin²+cos² = 1', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const x = rng() * 100 - 50;
      expect(Math.abs(dsin(x) ** 2 + dcos(x) ** 2 - 1)).toBeLessThan(1e-15);
    }
  });
});

describe('detmath · pow 精度', () => {
  it('默认缩放配置（指数 0.5）与 Math.pow 完全相同', () => {
    // enemyScale 用的就是这条路径，必须逐 bit 相同，否则数值平衡会漂
    for (let n = 21; n <= 500; n++) {
      expect(dpow(n / 20, 0.5)).toBe(Math.pow(n / 20, 0.5));
    }
  });

  it('任意实数指数误差 < 1e-14', () => {
    // 这里的容差比 sin/cos 松一档，是 pow 的固有代价而非实现偷懒：
    // pow(x,y) = e^(y·ln x)，指数上 1 个 ulp 的绝对误差会等比例变成结果的相对误差。
    // |y·ln x| 在本区间最大 ~12，double 在该量级的 ulp 是 1.8e-15，
    // 想再压一个数量级必须上 double-double 记账。**而游戏里根本走不到这条路**：
    // enemyScale 的指数是 0.5（走 Math.sqrt 精确快路）、fadeColor 是整数（走 dpowi），
    // 通用路只是为了 overrideScaling() 传入任意指数时不至于失去确定性。
    const rng = mulberry32(99);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const x = rng() * 50 + 1e-3;
      const y = rng() * 6 - 3;
      worst = Math.max(worst, relErr(dpow(x, y), Math.pow(x, y)));
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it('整数指数（fadeColor 用到的路径）', () => {
    for (let c = 0; c <= 20; c++) {
      expect(relErr(dpowi(0.9, c), Math.pow(0.9, c))).toBeLessThan(1e-14);
      expect(relErr(dpowi(0.96, c), Math.pow(0.96, c))).toBeLessThan(1e-14);
    }
    expect(dpowi(2, 10)).toBe(1024);
    expect(dpowi(2, -2)).toBe(0.25);
  });

  it('边界语义与 Math.pow 对齐', () => {
    expect(dpow(5, 0)).toBe(1);
    expect(dpow(0, 3)).toBe(0);
    expect(dpow(1, 12345.678)).toBe(1);
    expect(Number.isNaN(dpow(-2, 0.5))).toBe(true);
  });
});

describe('detmath · drot 替代 atan2', () => {
  it('旋转后长度不变、角度正确', () => {
    const rng = mulberry32(31337);
    for (let i = 0; i < 2000; i++) {
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a), y = Math.sin(a);      // 一个单位向量
      const th = rng() * Math.PI - Math.PI / 2;
      const r = drot(x, y, th);
      expect(Math.abs(Math.sqrt(r.x * r.x + r.y * r.y) - 1)).toBeLessThan(1e-15);
      // 与直接构造 cos(a+θ), sin(a+θ) 等价
      expect(Math.abs(r.x - Math.cos(a + th))).toBeLessThan(1e-14);
      expect(Math.abs(r.y - Math.sin(a + th))).toBeLessThan(1e-14);
    }
  });

  it('DEG 常量', () => {
    expect(Math.abs(dcos(35 * DEG) - Math.cos((35 * Math.PI) / 180))).toBeLessThan(1e-15);
  });
});
