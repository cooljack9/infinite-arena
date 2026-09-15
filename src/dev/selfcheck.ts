// ── 浏览器端确定性自检 ──
// 目的：验证**本机浏览器引擎**与服务端（Deno/V8）算出的战斗逐 bit 一致。
//
// 为什么必须在真机上跑：Node 与 Deno 都是 V8，两者一致不能推出"所有浏览器一致"。
// iOS Safari 用 JavaScriptCore、Firefox 用 SpiderMonkey，都是**独立实现**的
// Math.hypot / cos / sin / atan2——而 ECMA-262 对这些超越函数只要求近似，
// 明确允许 ULP 级差异。
//
// 本页分成两块，构成一组对照实验：
//   【判定】战斗指纹 + detmath 采样指纹 —— 必须全绿，红了说明该设备不能用本地复现通路
//   【对照】裸 Math.* 探针 —— **预期在非 V8 引擎上飘红**，它展示的正是被修掉的那个 bug
// 只看到"全绿"是没有信息量的；对照组飘红才证明这台机器确实是另一套超越函数实现，
// 而战斗结果依然一致 —— 那才是修复真的生效了。
import { LocalBackend, MemoryStore } from '../backend/LocalBackend';
import { CORE_VERSION } from '@arena/core/contract';
import { replayBattle } from '@arena/core/rules';
import { dsin, dcos, dpow } from '@arena/core/engine/detmath';
import { mulberry32 } from '@arena/core/engine/rng';

/**
 * 战斗样本必须与 scripts/cross-runtime.ts 完全一致（改一处两处都要改），
 * 否则浏览器与 Node/Deno 的结果没有可比性。
 */
const SEEDS = [20260808, 777001, 424242];
const LAYERS = 8;

/**
 * Node 22 + Deno 2.9（均为 V8）实测基准。真机不同 = 该引擎有浮点差异。
 *
 * ⚠️ 只有 `fingerprint` / `ticks` 与 cross-runtime.ts 同值可直接对照；
 * `det.*` **不要**拿去和 cross-runtime 输出的 `detProbe.digest` 比 ——
 * 两边的摘要算法不同（那边单循环拼接三个函数，这边分 sample/scan 两种口径
 * 且多算了 `sqrt(dx²+dy²)`），数值天然不等，不是漂移。
 * 判断 detmath 是否漂，只看**同一份脚本**在不同运行时上的输出是否相同。
 */
const BASELINE = {
  fingerprint: '-122f581e',
  ticks: [139, 54, 228, 85, 185, 136, 1292, 113, 113, 113, 24, 342, 537, 243, 682, 623, 309, 621],
  det: {
    digest: '-78d4b361',
    dsin: '44cef51f',
    dcos: '-150d0e6c',
    dpow: '-5af87ddc',
    // 五个运行时实测同值。对照 Math.hypot 在同样输入下有 3 个不同实现
    'sqrt(dx²+dy²)': '-216bb90',
  } as Record<string, string>,
  /**
   * 对照组参考值。**刻意没有"基准"一说**——这些值在不同引擎、
   * 甚至同一引擎的不同大版本之间都不同（实测 Node 的 V8 12.4 与 Deno 的 V8 15.0
   * 在 sin/cos/pow/atan2/exp/log 上六项全不同），所以本页只展示、不判定。
   */
  nativeRef: {
    'V8 12.4 (Node 22)': {
      'Math.sin': '-3fbee868', 'Math.cos': '588ddd82', 'Math.pow': '-783b9341',
      'Math.atan2': '-22fe9bac', 'Math.hypot': '-30851a59', 'Math.exp': '1396dcb2',
      'Math.log': '6c4ced60', 'Math.sqrt': '-783552c1',
    },
    'V8 15.0 (Deno 2.9)': {
      'Math.sin': '61f56877', 'Math.cos': '3ddadf8a', 'Math.pow': '-552b6690',
      'Math.atan2': '-40617709', 'Math.hypot': '-30851a59', 'Math.exp': '-435ee68d',
      'Math.log': '-2154eb66', 'Math.sqrt': '-783552c1',
    },
  } as Record<string, Record<string, string>>,
};

const el = (h: string) => {
  const d = document.createElement('div');
  d.innerHTML = h;
  return d;
};

const digestOf = (s: string) =>
  s.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(16);

async function run() {
  const root = document.getElementById('root')!;
  root.appendChild(el('<h2>确定性自检运行中…</h2>'));

  const be = new LocalBackend(new MemoryStore());
  const sums: string[] = [];
  const ticks: number[] = [];
  let replayMismatch = 0;
  const t0 = performance.now();

  for (const seed of SEEDS) {
    const s = await be.startRun({
      heroIds: ['h_physTank', 'h_gunner', 'h_healer'],
      mode: 'normal', idempotencyKey: `x_${seed}`,
      coreVersion: CORE_VERSION, debugSeed: seed,
    });
    if (!s.ok) break;
    for (let L = 0; L < LAYERS; L++) {
      const cur = await be.queryRun(s.data.runId);
      if (!cur.ok || cur.data.status !== 'active') break;
      const b = await be.startBattle({
        runId: s.data.runId, idempotencyKey: `x_${seed}_${L}`,
        coreVersion: CORE_VERSION, formation: {}, clientTs: 0,
      });
      if (!b.ok) break;
      const r = replayBattle(b.data.replay);
      if (r.checksum !== b.data.replay.checksum) replayMismatch++;
      sums.push(b.data.replay.checksum, r.checksum);
      ticks.push(b.data.outcome.totalTicks);
    }
  }
  const ms = performance.now() - t0;
  const fingerprint = digestOf(sums.join(','));

  // ── A/B 采样：**同一批 2 万组输入**，分别喂给 detmath 和原生 Math ──
  // 单点探针测不出问题（实测三引擎在 Math.cos(0.6154797086703873) 上恰好一致），
  // 当初能发现分叉靠的就是批量采样。所以对照组必须用同样的输入规模，
  // 否则「Firefox 全绿」会被误读成「Firefox 本来就没差异」。
  const SAMPLES = 20000;
  const sample = (fns: {
    sin: (x: number) => number; cos: (x: number) => number;
    pow: (x: number, y: number) => number; hyp: (a: number, b: number) => number;
  }) => {
    const rng = mulberry32(20260808);
    let acc = '';
    for (let i = 0; i < SAMPLES; i++) {
      const x = rng() * 80 - 40;
      acc += fns.sin(x).toString() + fns.cos(x).toString()
        + fns.pow(rng() * 50 + 1e-3, rng() * 6 - 3).toString()
        + fns.hyp(rng() * 40 - 20, rng() * 40 - 20).toString();
    }
    return digestOf(acc);
  };

  /** 单函数 2 万点摘要 */
  const scan = (f: (r: () => number) => number) => {
    const rng = mulberry32(20260808);
    let acc = '';
    for (let i = 0; i < SAMPLES; i++) acc += f(rng).toString() + ',';
    return digestOf(acc);
  };

  const det: Record<string, string> = {
    digest: sample({
      sin: dsin, cos: dcos, pow: dpow,
      hyp: (a, b) => Math.sqrt(a * a + b * b),   // len2d 的等价式
    }),
    dsin: scan((r) => dsin(r() * 80 - 40)),
    dcos: scan((r) => dcos(r() * 80 - 40)),
    dpow: scan((r) => dpow(r() * 50 + 1e-3, r() * 6 - 3)),
    'sqrt(dx²+dy²)': scan((r) => { const a = r() * 40 - 20, b = r() * 40 - 20; return Math.sqrt(a * a + b * b); }),
  };

  /** 对照组：逐函数摘要。本页**不对它做判定**——它在每个引擎上都可能不同，那正是结论本身 */
  const native: Record<string, string> = {
    'Math.sin': scan((r) => Math.sin(r() * 80 - 40)),
    'Math.cos': scan((r) => Math.cos(r() * 80 - 40)),
    'Math.pow': scan((r) => Math.pow(r() * 50 + 1e-3, r() * 6 - 3)),
    'Math.atan2': scan((r) => Math.atan2(r() * 40 - 20, r() * 40 - 20)),
    'Math.hypot': scan((r) => Math.hypot(r() * 40 - 20, r() * 40 - 20)),
    'Math.exp': scan((r) => Math.exp(r() * 20 - 10)),
    'Math.log': scan((r) => Math.log(r() * 1000 + 1e-6)),
    'Math.sqrt': scan((r) => Math.sqrt(r() * 1e6)),
  };

  const fpOk = fingerprint === BASELINE.fingerprint;
  const tickOk = JSON.stringify(ticks) === JSON.stringify(BASELINE.ticks);
  // 空基准 = 尚未固化的项，跳过判定
  const badDet = Object.keys(det).filter((k) => BASELINE.det[k] && det[k] !== BASELINE.det[k]);
  const allOk = fpOk && tickOk && replayMismatch === 0 && badDet.length === 0;

  // 本机原生实现与哪些已知 V8 版本对得上？一个都对不上 = 这是第三种实现
  const refNames = Object.keys(BASELINE.nativeRef);
  const matchedRefs = refNames.filter((n) =>
    Object.keys(native).every((k) => native[k] === BASELINE.nativeRef[n][k]));
  const nativeDiffCount = Object.keys(native).filter((k) =>
    refNames.every((n) => native[k] !== BASELINE.nativeRef[n][k])).length;

  root.innerHTML = '';
  root.appendChild(el(`
    <h2 class="${allOk ? 'ok' : 'bad'}">${allOk
      ? '✅ 本机与服务端逐 bit 一致 —— 可用「本地复现」通路'
      : '❌ 检出差异 —— 本机须降级为服务端事件流通路'}</h2>
    <p class="dim">${navigator.userAgent}</p>

    <h2>【判定】战斗一致性</h2>
    <table>
      <tr><td>战斗场次</td><td>${ticks.length}</td><td></td></tr>
      <tr><td>耗时</td><td>${ms.toFixed(0)} ms（${(ms / Math.max(1, ticks.length)).toFixed(1)} ms/场）</td><td></td></tr>
      <tr><td>本地复现 vs 后端 checksum</td>
          <td>${replayMismatch === 0 ? '全等' : `${replayMismatch} 场不符`}</td>
          <td class="${replayMismatch === 0 ? 'ok' : 'bad'}">${replayMismatch === 0 ? 'PASS' : 'FAIL'}</td></tr>
      <tr><td>整体指纹</td><td><code>${fingerprint}</code> ${fpOk ? '' : `≠ 基准 <code>${BASELINE.fingerprint}</code>`}</td>
          <td class="${fpOk ? 'ok' : 'bad'}">${fpOk ? 'PASS' : 'FAIL'}</td></tr>
      <tr><td>tick 序列</td><td>${tickOk ? '与基准一致' : `<code>${ticks.join(',')}</code>`}</td>
          <td class="${tickOk ? 'ok' : 'bad'}">${tickOk ? 'PASS' : 'FAIL'}</td></tr>
    </table>

    <h2>【判定】detmath 确定性数学库（每项 ${SAMPLES} 点采样）</h2>
    <table>
      ${Object.keys(det).map((k) => {
        const ref = BASELINE.det[k];
        if (!ref) return `<tr><td>${k}</td><td><code>${det[k]}</code></td><td class="dim">未固化基准</td></tr>`;
        const good = det[k] === ref;
        return `<tr><td>${k}</td><td><code>${det[k]}</code></td>
          <td class="${good ? 'ok' : 'bad'}">${good ? 'PASS' : `FAIL（基准 ${ref}）`}</td></tr>`;
      }).join('')}
    </table>

    <h2>【对照】原生 <code>Math.*</code> 逐函数摘要 —— 仅展示，不判定</h2>
    <table>
      <tr><td><b>函数</b></td><td><b>本机</b></td><td><b>对上了哪个已知实现</b></td></tr>
      ${Object.keys(native).map((k) => {
        const hits = refNames.filter((n) => native[k] === BASELINE.nativeRef[n][k]);
        return `<tr><td>${k}</td><td><code>${native[k]}</code></td>
          <td class="${hits.length ? 'dim' : 'warn'}">${hits.length ? hits.join(' / ') : '都对不上 —— 第三种实现'}</td></tr>`;
      }).join('')}
    </table>
    <p class="dim">
      本机与已知实现的匹配情况：<b>${matchedRefs.length ? matchedRefs.join(' / ') : '无一整体匹配'}</b>，
      其中 <b>${nativeDiffCount}</b> / ${Object.keys(native).length} 项是两个已知 V8 版本都没有的新值。
      <br>
      参照组里 <b>V8 12.4 与 V8 15.0 是同一个引擎的两个大版本</b>，它们在 sin/cos/pow/atan2/exp/log
      上六项全不相同 —— 所以「跨引擎不一致」其实说小了，真实情况是<b>跨版本就不一致</b>：
      服务端例行升级一次运行时，就能让全体玩家的本地回放对不上，而且不会有任何报警。
      上方两块「判定」全绿，说明战斗结果已经完全不依赖这些函数了。
    </p>
    <p class="dim">战斗基准 = Node 22 / Deno 2.9 一致值。背景与实测数据：docs/backend/07_跨引擎浮点一致性.md</p>
  `));
}

run().catch((e) => {
  document.getElementById('root')!.innerHTML =
    `<h2 class="bad">自检崩溃</h2><pre>${String(e && (e as Error).stack || e)}</pre>`;
});
