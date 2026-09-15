// 内容/任务全量清单（"拉取全部任务"）：从代码真值来源导出，不做任何假设。
import { HEROES } from '../packages/core/src/content/heroes';
import { SUBCLASS_INFO, ALL_SUBCLASSES, BODY_INFO, ALL_BODY_TYPES } from '../packages/core/src/content/classes';
import { SKILLS, SUBCLASS_SKILL, SKILL_VFX } from '../packages/core/src/content/skills';
import { RARITY_CFG, AFFIX_POOL, CHEST_TABLE, NEGATIVE_AFFIXES } from '../packages/core/src/content/equipment';
import { ENEMIES, BOSSES, STRONG_BOSSES, NORMAL_BOSSES, ENEMIES_BY_CAT } from '../packages/core/src/content/enemies';
import { MOUNTS, MOUNT_KINDS, MOUNT_RARITY } from '../packages/core/src/content/mounts';
import { RELICS } from '../packages/core/src/content/relics';
import { TRAITS } from '../packages/core/src/content/traits';
import { TALENTS } from '../packages/core/src/content/talents';
import { SUMMON_TEMPLATES, MAX_SUMMONS } from '../packages/core/src/content/summons';
import { CONSUMABLE_CFG } from '../packages/core/src/content/consumables';
import { ARENA_LIST, ARENAS, MAP_THEMES, WEATHER_BY_THEME, genArena, type ArenaArchetype } from '../packages/core/src/content/arenas';
import { rollRandomEvent } from '../packages/core/src/content/events';
import { TUTORIAL } from '../packages/core/src/content/tutorial';
import { INTRO, HERO_CALL, BOSS_LINES, EPILOGUE, bossLineFor } from '../packages/core/src/content/story';
import { PERSONALITIES, PERSONALITY_IDS } from '../packages/core/src/content/personalities';
import { capFor, NOVICE_CAP, ENDLESS_CAP, DEMO_CAP, bossTierAt } from '../packages/core/src/engine/scaling';
import { mulberry32 } from '../packages/core/src/engine/rng';

const L: string[] = [];
const line = (s = '') => L.push(s);
const kv = (k: string, v: unknown) => L.push(`  ${k}: ${v}`);

line('# 无限勇者竞技场 · 全量内容/任务清单（真值来源导出）');
line('');

// 进度/任务结构
line('## 一、进度与任务结构（层 = 任务）');
kv('模式 → 封顶层', `novice=${capFor('novice')} / normal=${capFor('normal')} / ironman=${capFor('ironman')}`);
kv('DEMO_CAP（Demo 通关里程碑）', DEMO_CAP);
kv('NOVICE_CAP（新手教学战役）', NOVICE_CAP);
kv('ENDLESS_CAP（深塔登顶）', ENDLESS_CAP);
const bossLayers: string[] = [];
for (let n = 1; n <= 30; n++) { const t = bossTierAt(n); if (t) bossLayers.push(`${n}(${t === 'strong' ? '强Boss' : 'Boss'})`); }
kv('Boss 节奏（1..30 层）', bossLayers.join(' '));
kv('主题循环', `每 10 层切换，6 主题 × 10 = 60 层一轮（见 MAP_THEMES）`);
line('');

// 英雄
line('## 二、英雄（9 名，每子类 1 名）');
for (const h of HEROES) {
  kv(h.id, `${h.name}｜子类=${h.subclass}｜特质=${h.traitId}｜基础=${JSON.stringify(h.basePrimary)}`);
}
line('');

// 职业子类 + 体型
line('## 三、职业子类与体型');
kv('职业子类数', ALL_SUBCLASSES.length);
for (const s of ALL_SUBCLASSES) kv('  subclass', `${s} → ${SUBCLASS_INFO[s].cn}（${SUBCLASS_INFO[s].category}）`);
kv('体型数', ALL_BODY_TYPES.length);
for (const b of ALL_BODY_TYPES) kv('  body', `${b} → ${BODY_INFO[b].cn}（hp×${BODY_INFO[b].hpMult} ms×${BODY_INFO[b].msMult}）`);
line('');

// 技能
line('## 四、技能');
kv('技能总数', Object.keys(SKILLS).length);
for (const k of Object.keys(SKILLS)) kv('  skill', `${k} → ${SKILLS[k].name}`);
kv('职业→技能映射', ALL_SUBCLASSES.map((s) => `${s}=${SUBCLASS_SKILL[s]}`).join(' '));
kv('技能特效风格数', Object.keys(SKILL_VFX).length);
line('');

// 装备
line('## 五、装备系统');
kv('稀有度', Object.keys(RARITY_CFG).join(' / '));
kv('词条池键数', Object.keys(AFFIX_POOL).length);
kv('宝箱表层数', Object.keys(CHEST_TABLE).length);
kv('负面词条数', NEGATIVE_AFFIXES.length);
line('');

// 敌人
line('## 六、敌人');
kv('敌人数', ENEMIES.length);
kv('Boss 数', BOSSES.length);
kv('  强力Boss(titan)', STRONG_BOSSES.length);
kv('  普通Boss(colossal)', NORMAL_BOSSES.length);
const cats = ['tank', 'warrior', 'archer', 'mage'] as const;
for (const c of cats) kv(`  非Boss·${c}类`, ENEMIES_BY_CAT(c).length);
line('');

// 坐骑
line('## 七、坐骑');
kv('坐骑种类', MOUNT_KINDS.join(' / '));
kv('坐骑稀有度', Object.keys(MOUNT_RARITY).join(' / '));
line('');

// 圣物/特质/天赋/召唤/消耗品/性格
line('## 八、养成与外援系统');
kv('圣物 Relics', RELICS.length);
kv('特质 Traits', Object.keys(TRAITS).length);
kv('天赋 Talents', TALENTS.length);
kv('召唤物模板', Object.keys(SUMMON_TEMPLATES).join(' / ') + `（同屏上限 ${MAX_SUMMONS}）`);
kv('消耗品种类', Object.keys(CONSUMABLE_CFG).join(' / '));
kv('性格 Personalities', PERSONALITY_IDS.join(' / '));
line('');

// 竞技场/主题/天气
line('## 九、竞技场 / 主题 / 天气');
kv('布局原型(ARENAS)', Object.keys(ARENAS).join(' / '));
kv('ARENA_LIST 张数', ARENA_LIST.length);
const ARCH: ArenaArchetype[] = ['A1', 'A3', 'A6', 'RIVER', 'JIANGE', 'DRAGON', 'CAGE'];
for (const a of ARCH) { const g = genArena(a, 1); kv(`  ${a}`, `${g.name} ${g.width}×${g.height}`); }
kv('地图主题数', Object.keys(MAP_THEMES).length);
for (const k of Object.keys(MAP_THEMES)) kv('  主题', `${k} → ${MAP_THEMES[k as keyof typeof MAP_THEMES].cn}`);
kv('天气数', Object.keys(WEATHER_BY_THEME).length);
line('');

// 奇遇
line('## 十、随机奇遇（战前抉择）');
const seen = new Map<string, number>();
for (let layer = 1; layer <= 60; layer++) {
  const ev = rollRandomEvent(mulberry32((layer * 2654435761) >>> 0), layer, false);
  if (ev) seen.set(ev.id ?? ev.title, (seen.get(ev.id ?? ev.title) ?? 0) + 1);
}
kv('采样 60 层出现的奇遇种类', seen.size);
for (const [id, n] of seen) kv('  ', `${id} ×${n}`);
line('');

// 教学
line('## 十一、新手教学（Tutorial）');
let stepCount = 0;
for (const g of TUTORIAL) { stepCount += g.steps?.length ?? 0; kv(`  层${g.layer}/${g.screen}`, `${g.steps?.length ?? 0} 步`); }
kv('教学步骤合计', stepCount);
line('');

// 剧情
line('## 十二、剧情与台词');
kv('开场 INTRO', `已定义（${INTRO.length} 字）`);
kv('召唤台词分类', Object.keys(HERO_CALL).join(' / '));
kv('Boss 台词层数', Object.keys(BOSS_LINES).length + `（覆盖层：${Object.keys(BOSS_LINES).join(',')}）`);
kv('尾声 EPILOGUE', `已定义（${EPILOGUE.length} 字）`);
line('');

// 校验
line('## 校验');
kv('全部模块成功导入', 'YES（来自 packages/core/src 真值来源）');

const out = L.join('\n');
console.log(out);
