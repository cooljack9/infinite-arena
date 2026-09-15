// ── 超越函数大规模扫描 ──
// selfcheck 里 7 个手挑的探针值全 PASS，但整场战斗仍跨引擎分叉。
// 说明差异藏在某些特定输入上，而不是"这个函数整体实现不同"。
// 这里对每个函数扫 20000 个确定性生成的输入，把结果压成指纹逐个比对，
// 目标是定位到**具体哪个函数、哪个输入**开始漂。
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把一串 double 压成 hex 指纹（走 bit 级，不经十进制字符串） */
function fp(vals: number[]): string {
  const buf = new Float64Array(vals);
  const u32 = new Uint32Array(buf.buffer);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < u32.length; i++) {
    h1 = Math.imul(h1 ^ u32[i], 16777619) >>> 0;
    h2 = (Math.imul(h2 + u32[i], 2246822519) ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const N = 20000;
const FNS: Record<string, (r: () => number) => number> = {
  hypot: (r) => Math.hypot(r() * 40 - 20, r() * 40 - 20),
  hypot_tiny: (r) => Math.hypot(r() * 1e-7, r() * 1e-7),
  atan2: (r) => Math.atan2(r() * 40 - 20, r() * 40 - 20),
  cos: (r) => Math.cos(r() * Math.PI * 4 - Math.PI * 2),
  sin: (r) => Math.sin(r() * Math.PI * 4 - Math.PI * 2),
  tan: (r) => Math.tan(r() * 3 - 1.5),
  pow: (r) => Math.pow(r() * 3 + 0.01, r() * 6 - 3),
  exp: (r) => Math.exp(r() * 20 - 10),
  log: (r) => Math.log(r() * 1000 + 1e-6),
  sqrt: (r) => Math.sqrt(r() * 1e6),
  cbrt: (r) => Math.cbrt(r() * 1e6 - 5e5),
  // 对照组：纯 IEEE 754 四则运算，必须全引擎一致
  arith: (r) => { const a = r() * 1e6, b = r() * 1e-3; return ((a * b + a / (b + 1)) - a) * b; },

  // ── 候选修复：用 IEEE 754 保证的运算替代超越函数 ──
  // sqrt 与 +−×÷ 都被 IEEE 754 要求正确舍入，跨引擎必然一致。
  // 若这两行全引擎同指纹，说明「把 Math.hypot 换成 sqrt 实现」可行。
  hypot_fix: (r) => {
    const dx = r() * 40 - 20, dy = r() * 40 - 20;
    return Math.sqrt(dx * dx + dy * dy);
  },
  // 极端量级下 dx*dx 可能溢出/下溢，故需缩放版本；一并验证其确定性
  hypot_fix_scaled: (r) => {
    const dx = r() * 1e-7, dy = r() * 1e-7;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const m = ax > ay ? ax : ay;
    if (m === 0) return 0;
    const x = dx / m, y = dy / m;
    return Math.sqrt(x * x + y * y) * m;
  },
};

export function scan(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, f] of Object.entries(FNS)) {
    const r = mulberry32(12345);          // 每个函数用同一串输入
    const vals: number[] = new Array(N);
    for (let i = 0; i < N; i++) vals[i] = f(r);
    out[name] = fp(vals);
  }
  return out;
}

// 浏览器入口
if (typeof document !== 'undefined') {
  const res = scan();
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<pre>${navigator.userAgent}\n\n${
      Object.entries(res).map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n')
    }</pre>`;
  }
  (window as unknown as { __scan: Record<string, string> }).__scan = res;
}
