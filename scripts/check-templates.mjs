// 模板行宽校验：像素模板一旦某行少一格，整个角色就会横向错位且极难肉眼定位。
// 这个脚本被 npm run verify 串进流水线，改模板改错会在 CI 直接红。
import { readFileSync } from 'node:fs';

const files = ['src/render/sprite-templates.ts'];
let bad = 0;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const blockRe = /(\w+):\s*\[\s*((?:\s*'[^']*',\s*)+)\]/g;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const name = m[1];
    const rows = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    const widths = [...new Set(rows.map((r) => r.length))];
    if (widths.length === 1) {
      console.log(`  OK  ${name.padEnd(12)} ${rows.length} rows x ${widths[0]} cols`);
    } else {
      bad++;
      const mode = rows
        .map((r) => r.length)
        .sort((a, b) => rows.filter((x) => x.length === a).length - rows.filter((x) => x.length === b).length)
        .pop();
      console.log(`  BAD ${name.padEnd(12)} widths=${widths.join(',')} (expected ${mode})`);
      rows.forEach((r, i) => {
        if (r.length !== mode) console.log(`      r${String(i).padStart(2)} len=${r.length} |${r}|`);
      });
    }
  }
}

if (bad) {
  console.error(`\n模板校验失败：${bad} 个模板行宽不一致`);
  process.exit(1);
}
console.log('\n模板校验通过');
