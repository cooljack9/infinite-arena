// 给 economy.ts 核心命令注入 Remote 分支（云端写操作代理）
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/game/state/slices/economy.ts';
let src = readFileSync(FILE, 'utf8');

// 每个核心命令：签名正则 + Remote 分支体（$P 占位参数）
const PLAN = [
  {
    fn: 'buyItem',
    sig: /(buyItem: \(\s*id\s*\)\s*=>\s*\{)/,
    body: (p) => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.buyItem({ ...env, itemId: ${p} }));\n    return;\n  }\n`,
    params: 'id',
  },
  {
    fn: 'sellItem',
    sig: /(sellItem: \(\s*id\s*\)\s*=>\s*\{)/,
    body: (p) => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.sellItem({ ...env, equipmentId: ${p} }));\n    return;\n  }\n`,
    params: 'id',
  },
  {
    fn: 'openDrop',
    sig: /(openDrop: \(\s*id\s*\)\s*=>\s*\{)/,
    body: (p) => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.openDrop({ ...env, chestId: ${p} }));\n    return;\n  }\n`,
    params: 'id',
  },
  {
    fn: 'equipItem',
    sig: /(equipItem: \(\s*uid\s*,\s*eqId\s*\)\s*=>\s*\{)/,
    body: (p) => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.equipItem({ ...env, uid: ${p[0]}, equipmentId: ${p[1]} }));\n    return;\n  }\n`,
    params: ['uid', 'eqId'],
  },
  {
    fn: 'unequipItem',
    sig: /(unequipItem: \(\s*uid\s*,\s*eqId\s*\)\s*=>\s*\{)/,
    body: (p) => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.unequipItem({ ...env, uid: ${p[0]}, equipmentId: ${p[1]} }));\n    return;\n  }\n`,
    params: ['uid', 'eqId'],
  },
  {
    fn: 'refreshShop',
    sig: /(refreshShop: \(\s*free\s*=\s*false\s*\)\s*=>\s*\{)/,
    body: () => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.refreshShop(env));\n    return;\n  }\n`,
    params: [],
  },
  {
    fn: 'recruit',
    sig: /(recruit: \(\s*heroId\s*\)\s*=>\s*\{)/,
    body: (p) => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.recruit({ ...env, heroId: ${p} }));\n    return;\n  }\n`,
    params: 'heroId',
  },
  {
    fn: 'refreshRecruit',
    sig: /(refreshRecruit: \(\s*\)\s*=>\s*\{)/,
    body: () => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.refreshRecruit(env));\n    return;\n  }\n`,
    params: [],
  },
  {
    fn: 'upgradeHero',
    sig: /(upgradeHero: \(\s*uid\s*\)\s*=>\s*\{)/,
    body: (p) => `  if (isRemoteMode()) {\n    void remoteWrite(get, set, (b, env) => b.upgradeHero({ ...env, uid: ${p} }));\n    return;\n  }\n`,
    params: 'uid',
  },
];

let injected = 0;
for (const item of PLAN) {
  const m = src.match(item.sig);
  if (!m) { console.log('! 未命中:', item.fn); continue; }
  src = src.replace(item.sig, `${m[1]}\n${item.body(item.params)}`);
  injected++;
}

// ── 组合操作：buyAllShop / equipAll（Remote 逐个走基础命令）──
// buyAllShop：逐件异步买 + 买空免费刷新
const ba = src.match(/(buyAllShop: \(\s*\)\s*=>\s*\{)/);
if (ba) {
  src = src.replace(ba[1], `${ba[1]}\n  if (isRemoteMode()) {\n    const run = get().run;\n    if (!run) return 0;\n    const ids = [\n      ...get().shopStock.equipment.map((e) => e.id),\n      ...get().shopStock.consumables.map((c) => c.id),\n    ];\n    for (const id of ids) get().buyItem(id);\n    if (get().shopStock.equipment.length === 0 && get().shopStock.consumables.length === 0) {\n      get().refreshShop(true);\n    }\n    return ids.length;\n  }\n`);
  injected++;
}
// equipAll：Remote 逐 uid 对每件装备调 equipItem
const ea = src.match(/(equipAll: \(\s*uid\s*\)\s*=>\s*\{)/);
if (ea) {
  src = src.replace(ea[1], `${ea[1]}\n  if (isRemoteMode()) {\n    const run = get().run;\n    if (!run) return 0;\n    const targets = uid ? run.team.filter((h) => h.uid === uid) : run.team;\n    if (targets.length === 0) return 0;\n    let done = 0;\n    const pool = [...get().inventory];\n    for (const item of pool) {\n      const before = get().equipped;\n      let target = null;\n      let free = 0;\n      for (const h of targets) {\n        const f = 6 - (before[h.uid] ?? []).length;\n        if (f > free) { free = f; target = h; }\n      }\n      if (!target || free === 0) break;\n      get().equipItem(target.uid, item.id);\n      done++;\n    }\n    return done;\n  }\n`);
  injected++;
}

writeFileSync(FILE, src);
console.log(`注入完成（${injected}/11）`);
