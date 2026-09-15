// 像素模板库（美术 §4）。v2.3：16×20 → 20×20，并引入材质索引分层
//
// 为什么从 16×16 升到 20×20：
//   renderPx 区间是 24–50px，16×16 模板在 34px 上每个模板像素只有 2.1 个屏幕像素，
//   头部只剩 4×4，五官根本画不进去，剪影之外没有任何可读信息。
//   20×20 多出 56% 面积，刚好够塞下「眼睛 + 材质分界 + 武器结构」这三件让像素画
//   从「贴纸」变成「角色」的东西，同时不至于让 9 套模板的维护成本失控。
//
// 索引图例（材质分层是 Steam 级像素画与业余作品最直观的差距）：
//   .  透明
//   O  主描边（不是纯黑——按职业色调深，selective outline，让角色不从场景上「抠」出来）
//   o  内描边（部件之间的分界线，比 O 浅）
//   s  皮肤   S  皮肤暗部
//   e  眼神光（高对比，单像素就能定位视线方向）
//   a  职业主色   b  职业辅色
//   m  金属亮   M  金属暗（钢/机械/护肩）
//   l  皮革（腰带、箭袋、绑带）
//   w  布料高光/白（袍面受光、法术符纹底）
//   g  能量发光（会额外吃一圈像素级 bloom）
//   #  裤/靴（最深的中性色，把重量压在脚底）

import { SubClass, SummonKind, MonsterKind, MountKind, BuildingKind } from '@arena/core/types';

/** 角色模板边长（正方，20×20） */
export const TPL_W = 20;
export const TPL_H = 20;

export const TEMPLATES: Record<SubClass, string[]> = {
  // 玄武前排：凤翅兜鍪 + 红缨 + 兽面大橹盾 + 铁锏。
  // 剪影锚点是「左侧一块 6px 宽的方盾 + 头顶两片外翘凤翅」——远看就知道这是中式重甲将。
  physTank: [
    '....................',
    '.........gg.........',
    '........OggO........',
    '.......OOggOO.......',
    '......OmmmmmmO......',
    '.....OmOmmmmOmO.....',
    '.....OOsssssOO......',
    '.....OsSeSSeSO......',
    '.....OOsssssOO......',
    '.OOOOO.OOaaaOO.OMO..',
    'ObbbbO.OaaaaaO.OMO..',
    'ObmMmbOaabbbaaOMMMO.',
    'ObMOMbOaabbbaaOMMMO.',
    'ObmMmbOaaaaaaaOMMMO.',
    'ObbbbO.OllllllO.OMO.',
    '.OOOOO.OaaaaaaO.....',
    '.......O##O.O##O....',
    '.......O##O.O##O....',
    '......OMMMO.OMMMO...',
    '......OOOOO.OOOOO...',
  ],
  // 符甲战将：莲花道冠 + 头顶三道悬浮符箓 + 及地符纹重袍。
  // 三张竖符箓是全场唯一「一排三个等距发光块」的头顶特征，与玄武的凤翅完全不撞。
  magicTank: [
    '.....OgO.OgO.OgO....',
    '.....OwO.OwO.OwO....',
    '.....OgO.OgO.OgO....',
    '.......OObbOO.......',
    '......ObbbbbbO......',
    '.....ObbwwwwbbO.....',
    '.....OOsssssssO.....',
    '.....OsSeSSSeSO.....',
    '.....OOsssssssO.....',
    '....OOaaaaaaaaaOO...',
    '...ObaaabbbbbaaabO..',
    '..OgbaabbwwbbaabgO..',
    '..OObaaabbbbbaaabOO.',
    '...ObaaaaaaaaaaabO..',
    '...OaaaaaaaaaaaaaO..',
    '...OaaaabbbbbaaaaO..',
    '..OaaaaaaaaaaaaaaaO.',
    '..OllllllllllllllO..',
    '...O##OO....OO##O...',
    '...OOOO......OOOO...',
  ],
  // 武圣突袭（关羽）：幞头 + 五绺长髯 + 青龙偃月刀。
  // 长柄大刀从右上贯到腰际，刀头是全场唯一的「新月形金属块」；长髯给了它唯一的下颌轮廓。
  charge: [
    '..............OmmO..',
    '.............OmmmO..',
    '....OOOO....OmmMO...',
    '...ObbbbO..OmmMO....',
    '...ObwwbO.OMMO......',
    '...OsssssO.OMO......',
    '...OsSeSeO.OMO......',
    '...OOsssOO.OMO......',
    '..OObSSSbOOMO.......',
    '.OMaaSSSaaOllO......',
    '.OMaaabbbaaaO.......',
    '.OMaaabbbaaaO.......',
    '..OaaaaaaaaO........',
    '..OllllllllO........',
    '..OaaaaaaaO.........',
    '..O##O.O##O.........',
    '.O##O..O##O.........',
    'O##O....O##O........',
    'OOO......OOO........',
    '....................',
  ],
  // 无名剑客：斗笠 + 长衫 + 右侧竖直长剑 + 剑穗。
  // 斗笠檐只有 12px（比太极宗师窄），加上剑穗那一点发光，是「江湖客」而非「术士」。
  hexblade: [
    '....................',
    '.........OO.........',
    '........OwwO........',
    '.......OwwwwO.......',
    '....OOwwwwwwwwOO....',
    '....OOOOOOOOOOOO....',
    '.......OssssO.......',
    '.......OeSSeO...OmO.',
    '.......OssssO...OmO.',
    '.....OOaaaaaaOO.OmO.',
    '....OaaabbbbaaaOOmO.',
    '....OaabbwwbbaaOOmO.',
    '....OaaabbbbaaaOOMO.',
    '.....OaaaaaaaaO.OlO.',
    '.....OllllllllO.Og..',
    '.....OaaaaaaaaO.....',
    '.....OaaaaaaaO......',
    '....O##O..O##O......',
    '...O##O....O##O.....',
    '...OOO......OOO.....',
  ],
  // 神机炮手：明制笠盔 + 三眼铳。
  // 铳管是横向 6px 实心块 + 火门两点火星，是全场唯一「水平伸出体外的机械结构」。
  gunner: [
    '....................',
    '.........OO.........',
    '.....OOOOmmOOOO.....',
    '....OmmmmmmmmmmO....',
    '.....OOMMMMMMOO.....',
    '.....OsSeeSsO.......',
    '.....OOsssOO........',
    '....OOaaaaaOO.......',
    '...OMaaaaaaaMO......',
    '..OMMaabbbaaMMOOOOO.',
    '..OMMaabbbaaMMmMmMMO',
    '..OMMaaaaaaaMMmMmMMO',
    '...OMaaaaaaaMOOOOgg.',
    '...OllllllllO.......',
    '...OaaaaaaaaO.......',
    '...OaaaaaaaO........',
    '...O##O.O##O........',
    '..OMMO..OMMO........',
    '..OOOO..OOOO........',
    '....................',
  ],
  // 神射手·后羿：中式反曲长弓（两端弓梢外翻）+ 束发簪 + 右背箭袋。
  // 18px 高的竖弓 + 上下两个反曲弯钩，站桩感与射程一起从剪影读出来。
  sniper: [
    '..OO................',
    '.Om.................',
    'Om......OOOO........',
    'Om.....OaaaaO.......',
    '.Om...ObwwwwbO......',
    '.Om...OOsssOO.......',
    '.Om...OsSeeSO.......',
    'Og....OOsssOO...Ol..',
    '.Om..OOaaaaaOO..Oll.',
    '.Om..OaabbbaaO..Oll.',
    '.Om..OaabbbaaO.Oll..',
    '.Om...OaaaaaO.Oll...',
    'Om....OllllllO......',
    'Om....OaaaaaaO......',
    '.Om...OaaaaaO.......',
    '.Om...O##O##O.......',
    '..Om..O##.O##O......',
    '..OO..OMMO.OMMO.....',
    '......OOOO.OOOO.....',
    '....................',
  ],
  // 太极宗师：道髻 + 道袍 + 右侧悬浮太极盘。
  // 上窄下阔的钟形道袍 + 白色袍摆 + 一枚 4×4 阴阳鱼圆盘，与符甲战将的符箓头顶正交。
  controller: [
    '....................',
    '.......OO...........',
    '......ObbO..........',
    '.......OO...........',
    '.....OOssssOO.......',
    '.....OsSeeSsO...OOO.',
    '.....OOssssOO..OwwgO',
    '....OOaaaaaaOO.OwggO',
    '...OaaaabbaaaaO.OOO.',
    '...OaaaabgwbaaaO....',
    '...OaaabbwgbbaaaO...',
    '...OaaaabbbbaaaO....',
    '...OaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaaO...',
    '..OaaaabbbbbaaaaO...',
    '..OaaaaaaaaaaaaaO...',
    '.OaaaaaaaaaaaaaaaO..',
    '.OllllllllllllllllO.',
    '..OwwwwwwwwwwwwwO...',
    '..OOOOOOOOOOOOOOO...',
  ],
  // 女娲造人：人首蛇身。上身人形托泥丸，下身盘尾拖到画面底边。
  // 「没有腿」是它最狠的辨识点——全场唯一一个下半身是连续曲面的单位。
  summoner: [
    '....................',
    '.......OOOOO........',
    '......ObbbbbO.......',
    '.....ObbwwwbbO......',
    '.....ObOsssObO......',
    '.....ObOeSeObO......',
    '.....ObOsssObO......',
    '....OObbaaabbOO.....',
    '...ObaaaaaaaaabO....',
    '..ObaaaabgbaaaabO...',
    '..ObaaaabbbaaaabO...',
    '...ObaaaaaaaaabO....',
    '....OOaaaaaaaOO.....',
    '...ObbbaabbaabbO....',
    '..ObbbaabbbaabbbO...',
    '.ObbbbaabbbaabbbbO..',
    'ObbbbbaabbbaabbbbbO.',
    'OObbbbbbbbbbbbbbbOO.',
    '.OObbbbbbbbbbbbbOO..',
    '..OOOOOOOOOOOOOOO...',
  ],
  // 青囊神医（华佗）：儒巾 + 长须 + 右手药葫芦 + 腰间青囊。
  // 葫芦是唯一悬在体侧的「双球轮廓」，配长须与白袍摆，一眼是郎中不是法师。
  healer: [
    '....................',
    '.......OOOOO........',
    '......OwwwwwO.......',
    '......OwOOOwO.......',
    '.....OOsssssO..Og...',
    '.....OsSeeSsO.OgwgO.',
    '.....OOsssssO.OggwO.',
    '.....OSSSSSO...OO...',
    '....OOaSSSaOO.......',
    '...OaaawwaaaO..OmO..',
    '...OaawwwwaaO..OmO..',
    '...OaaawwaaaO.OmO...',
    '...OaaaaaaaaO.......',
    '..ObaagaaaaabO......',
    '..OaaaaaaaaaaO......',
    '..OaaaabbbaaaO......',
    '.OaaaaaaaaaaaaO.....',
    '.OaaaaaaaaaaaaO.....',
    '.OwwwwwwwwwwwwO.....',
    '..OOOOOOOOOOOO......',
  ],
};
// ── 召唤物模板（美术 §7.4.1）：14×14 ──
// 召唤物必须一眼不像英雄——它们是消耗品，不该分走玩家对主力的注意力。
// 辨识锚点：石魂卫是「方」，影刃仆是「尖」，咒火灵是「火焰 + 唯一暖色」。
export const SUMMON_TPL_SIZE = 14;

export const SUMMON_TEMPLATES_PX: Record<SummonKind, string[]> = {
  // 石魂卫：纯几何方块，裂纹 + 发光单眼。像一堵会走路的墙
  bulwark: [
    '..............',
    '...OOOOOOOO...',
    '..OMMMMMMMMO..',
    '..OMmmmmmmMO..',
    '..OMmOggOmMO..',
    '..OMmmmmmmMO..',
    '.OMMmmmmmmMMO.',
    '.OMmmmmmmmmMO.',
    '.OMmm.mm.mmMO.',
    '.OMmmmmmmmmMO.',
    '..OMMmmmmMMO..',
    '..OO#OOO#OO...',
    '...O##O.O##O..',
    '...OOOO.OOOO..',
  ],
  // 影刃仆：菱形、悬浮无腿、左右收成发光尖刺，底部拖一点残影
  sprinter: [
    '..............',
    '.....OOOO.....',
    '....OaaaaO....',
    '....OaggaO....',
    '....OaaaaO....',
    '..OOaaaaaaOO..',
    '.OaaaaaaaaaaO.',
    'OgaaaaaaaaaagO',
    '.OaaaaaaaaaaO.',
    '..OOaaaaaaOO..',
    '....OaaaaO....',
    '.....OaaO.....',
    '......OO......',
    '.......g......',
  ],
  // 咒火灵：上尖下收的火焰轮廓，核心两像素白热，全场唯一的纯暖色单位
  arcanist: [
    '......gg......',
    '.....OggO.....',
    '....OaggaO....',
    '...OaggggaO...',
    '.OaaggggggaaO.',
    '.OagggwwgggaO.',
    '.OagggwwgggaO.',
    '.OaaggggggaaO.',
    '..OaaggggaaO..',
    '...OaaggaaO...',
    '....OaaaaO....',
    '.....OaaO.....',
    '....O....O....',
    '..............',
  ],
};

export const SUMMON_PALETTE: Record<SummonKind, { a: string; o: string; glow: string }> = {
  bulwark:  { a: '#8a7a5a', o: '#2e2618', glow: '#ffd08a' },
  sprinter: { a: '#5a3480', o: '#160826', glow: '#c86bff' },
  arcanist: { a: '#ff6b2a', o: '#5a2208', glow: '#ffd23f' },
};

// ── 西方怪物模板（v2.5 需求 #2）──
// 与英雄完全正交：独立像素模板 + 独立配色，不走职业模板、不走红染。
// 龙 / 堕天使为 Boss 体型（titan / colossal），其余为常规波次怪。
// 索引沿用 hero 体系（a/b/g/O/o/m/s/e/w/l/#），故无需改 rasterize。
export const MONSTER_TEMPLATES: Record<MonsterKind, string[]> = {
  dragon: [
    '....................',
    '...O........O.......',
    '...OO..O...OO.......',
    '....O.OmO.OmO.O.....',
    '.....OOssssssO......',
    '....OssOeeOeeOssO...',
    '....OsOOsssssOOsO...',
    '.....OssbbbbbssO....',
    '....OssOOOOOOOssO...',
    '...OssaOaaaaaOassO..',
    '..OssaaaaaaaaaassO..',
    '..OssaaggaaggaassO..',
    '..OssaaaaaaaaaassO..',
    '...OssaaaaaaaaassO..',
    '....OssaaaaaaassO...',
    '.....OsssaaaassO....',
    '......OssssaaaO.....',
    '.......OsssssO......',
    '........OOOOO.......',
    '....................',
  ],
  fallen_angel: [
    '....................',
    '..O..............O..',
    '.OaO............OaO.',
    '.OaaO..........OaaO.',
    '..OaaOaO....OaOaaO..',
    '...OaaOaaOOaaOaaO...',
    '....OaaeOaaOeaaO....',
    '.....OaOaaaaOaO.....',
    '......OaaaaaaaO.....',
    '.....OaabbbbbaaO....',
    '....OaaaaaaaaaaaO...',
    '...OaaaaaaaaaaaaaO..',
    '...OaaaaaaaaaaaaaO..',
    '....OaaaaaaaaaaaO...',
    '.....OaaaaaaaaaO....',
    '......Oaa.a.aaO.....',
    '.......Oa...aO......',
    '........O...O.......',
    '.........OOO........',
    '....................',
  ],
  witch: [
    '........OO..........',
    '.......OwwO.........',
    '......OwwwwO........',
    '.....OwwwwwwO.......',
    '....OwwOsssOwwO.....',
    '...OwwOseOseOwwO....',
    '...OwwOsssssOwwO....',
    '....OwwbbbbbwwO.....',
    '.....OwaaaaawO......',
    '....OwaaggaaawO.....',
    '...OwaaaaaaaaawO....',
    '..OwaaaaaaaaaaawO...',
    '..OwaaaaaaaaaaawO...',
    '...OwaaaaaaaaawO....',
    '....OwaaaaaaawO.....',
    '.....OwaaaaawO......',
    '......OwwwwwwO......',
    '.......OwwwwO.......',
    '........OOOO........',
    '....................',
  ],
  demon: [
    '..O............O....',
    '..OO...OO...OO.O....',
    '...O.OmO.OmO.O......',
    '....OOsssssssO......',
    '...OssOeeOeeOssO....',
    '...OsOOsssssOOsO....',
    '....OssbbbbbssO.....',
    '...OssbOOOOObssO....',
    '..OssbaOaaaaOassO...',
    '.OssaaaaaaaaaaassO..',
    '.OssaaaggaaggaassO..',
    '.OssaaaaaaaaaaassO..',
    '..OssaaaaaaaaaassO..',
    '...OssaaaaaaaaassO..',
    '....OssaaaaaaassO...',
    '.....OsssaaaassO....',
    '......OssssaaaO.....',
    '.......OsssssO......',
    '........OOOOO.......',
    '....................',
  ],
  skeleton: [
    '....................',
    '.....OOOOOO.........',
    '....OssssssO........',
    '....OseOssOesO......',
    '....OsssssssO.......',
    '.....ObbbbbO........',
    '......OsssO.........',
    '.....OaaaaaO........',
    '....OaabbbbaaO......',
    '....OabOaObaO.......',
    '....OabaaaabO.......',
    '.....OaaaaaO........',
    '....OaaaaaaaO.......',
    '....OaaO.OaaO.......',
    '....OaO...OaO.......',
    '...OaaO...OaaO......',
    '...OaO.....OaO......',
    '...OO.......OO......',
    '....................',
    '....................',
  ],
  gargoyle: [
    'O..................O',
    'OO......OO......OO..',
    '..OO....OmO....OO...',
    '..O....OOO...O.O....',
    '...OaO.....OaO......',
    '....OaaOOOOaaO......',
    '.....OaeeeeeaO......',
    '......OaaaaaaO......',
    '.....OaabbbbaaO.....',
    '....OaaaaaaaaaaaO...',
    '...OaaaaaaaaaaaaaO..',
    '...OaaaaaaaaaaaaaO..',
    '....OaaaaaaaaaaaO...',
    '.....OaaaaaaaaO.....',
    '......Oaa..aaO......',
    '.......Oa..aO.......',
    '........OOOO........',
    '....................',
    '....................',
    '....................',
  ],
  // ── 兽类新增：恶魔狼 / 精灵狼（需求：龙加兽类标签 + 新增两狼）──
  // 共享侧面剪影（尖耳·长吻·四足·尾），靠调色板区分：
  // demon_wolf = 暗红烈焰；fae_wolf = 苍白灵光。索引沿用 a/b/g/O/o/s/e。
  demon_wolf: [
    '......O.......O.....',
    '......OO.....OO.....',
    '......OaO...OaO.....',
    '.......OaaOaaO......',
    'Oa......OasseaO.....',
    'Oa.....OassssaO.....',
    'OaO..OaaaaaaaaO.....',
    '.OaO.OaaaaaaaaaaO...',
    '..OaOaaaaaaaaaaaaO..',
    '...OaaaaaggaaaaaaaO.',
    '...OaaaaaaaaaaaaaaaO',
    '...OaaaaaaaaaaaaaaaO',
    '...OaabbbbbbbbbbaaaO',
    '....OaaaaaaaaaaaaaO.',
    '....OaaO....OaaO....',
    '....OaO......OaO....',
    '.....O........O.....',
    '....OO........OO....',
    '............OOO.....',
    '.............O......',
  ],
  fae_wolf: [
    '......O.......O.....',
    '......OO.....OO.....',
    '......OaO...OaO.....',
    '.......OaaOaaO......',
    'Oa......OasseaO.....',
    'Oa.....OassssaO.....',
    'OaO..OaaaaaaaaO.....',
    '.OaO.OaaaaaaaaaaO...',
    '..OaOaaaaaaaaaaaaO..',
    '...OaaaaaggaaaaaaaO.',
    '...OaaaaaaaaaaaaaaaO',
    '...OaaaaaaaaaaaaaaaO',
    '...OaabbbbbbbbbbaaaO',
    '....OaaaaaaaaaaaaaO.',
    '....OaaO....OaaO....',
    '....OaO......OaO....',
    '.....O........O.....',
    '....OO........OO....',
    '............OOO.....',
    '.............O......',
  ],
  // v2.9.x 面包车（cosplay 五菱宏光）：方正厢式车身 + 车窗 + 双轮。a=车身白 b=蓝条 g=车灯黄 o=描边
  van: [
    '....................',
    '....................',
    '...OOOOOOOOOOOO.....',
    '..OwwwwwwwwwwwwO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaabbbbaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '..OaaaaaaaaaaaaO....',
    '...OO......OO.......',
    '...OmO....OmO.......',
    '...OmO....OmO.......',
    '...OO......OO.......',
    '....................',
    '....................',
  ],
  // v2.9.x 面包人：刚下车的乘员。刻意做得矮小敦实（比常规小怪窄一格），
  // 一屏 28 个也要能一眼数清"人海"而不是糊成一团。a=夹克蓝 b=裤子深 g=脸黄 o=描边
  van_person: [
    '....................',
    '....................',
    '.......OOOO.........',
    '......OggggO........',
    '......OggggO........',
    '......OgOOgO........',
    '.......OOOO.........',
    '......OaaaaO........',
    '.....OaaaaaaO.......',
    '....OOaaaaaaOO......',
    '....OaOaaaaOaO......',
    '....OaOaaaaOaO......',
    '.....OOaaaaOO.......',
    '.......ObbO.........',
    '.......ObbO.........',
    '.......ObbO.........',
    '......OObOObO.......',
    '......OOOOOO........',
    '....................',
    '....................',
  ],
};

// 怪物调色板：a=主体 b=辅色 g=发光 o=描边
export const MONSTER_PALETTE: Record<MonsterKind, { a: string; b: string; g: string; o: string }> = {
  dragon:        { a: '#7a1f1f', b: '#b33030', g: '#ffd23f', o: '#160404' },
  fallen_angel:  { a: '#3a3a5a', b: '#6a6a9a', g: '#c08aff', o: '#0a0a18' },
  witch:         { a: '#5a3a8a', b: '#8a6ac0', g: '#7fff9a', o: '#180a28' },
  demon:         { a: '#8a1a1a', b: '#c43a2a', g: '#ff5a2a', o: '#160404' },
  skeleton:      { a: '#d8d2c0', b: '#b0a890', g: '#9fe0ff', o: '#2a2620' },
  gargoyle:      { a: '#7a7a82', b: '#9a9aa2', g: '#c0c0d0', o: '#1a1a20' },
  demon_wolf:    { a: '#3a1414', b: '#7a1f1f', g: '#ff5a2a', o: '#0a0404' },
  fae_wolf:      { a: '#9fd6e8', b: '#d8f0ff', g: '#aef6ff', o: '#16323a' },
  van:           { a: '#e8e8ec', b: '#3a6ea5', g: '#ffd23f', o: '#2a2230' },
  van_person:    { a: '#3a6ea5', b: '#2a3340', g: '#e8c49a', o: '#1a1620' },
};

// ── 材质调色板 ──
// 只有中性材质写死；a/b/g 三个索引由职业色注入，保证 9 个职业既统一又各有识别色。
export const MATERIAL: Record<string, string> = {
  o: '#2a2230',   // 内描边
  s: '#f0c49a',   // 皮肤
  S: '#c08256',   // 皮肤暗部
  e: '#ffffff',   // 眼神光
  m: '#c2cad6',   // 金属亮
  M: '#5f6774',   // 金属暗
  l: '#6b4a2f',   // 皮革
  w: '#f7f3e8',   // 布料高光
  '#': '#2b2334', // 裤/靴
};

/** 会吃像素级 bloom 的发光索引 */
export const GLOW_CHARS = new Set(['g', 'e']);

// ── 坐骑模板（v2.6 §2）：24×14，一律「侧视朝右」 ────────────────────
//
// 为什么不是 20×20：
//   坐骑画在骑手脚下，需要的是「宽而扁」的占位——正方形模板会让四足动物的腿被压成
//   两个色块，读不出兽种。24×14 的长宽比 1.7 才是四足侧影的自然比例。
//   朝左时由渲染层做水平镜像（ctx.scale(-1,1)），模板只维护一个朝向。
//
// 索引复用角色体系，其中：
//   a = 坐骑主色（MountDef.body）  b = 纹样/辅色（MountDef.accent）
//   O = 描边（MountDef.dark）      m/M = 象牙/铁蹄/包铁角   e = 兽瞳
export const MOUNT_TPL_W = 24;
export const MOUNT_TPL_H = 14;

export const MOUNT_TEMPLATES: Record<MountKind, string[]> = {
  // 战象：最厚重的一只。圆顶巨颅 + 耳廓缺口（O）+ 前伸象鼻与獠牙（m 戳出右缘），
  // 四腿粗柱。特征都长在头部且向前戳出，骑手盖住躯干也不影响识别「这是头象」。
  elephant: [
    '........................',
    '.......OOOOOOOOOOOO.....',
    '......OaaaaaaaaaaaOO....',
    '.....OaaaaaaaaaaaaaO....',
    '....OaaaaaaaaaaaaaaaO...',
    '...OaaaaaaaaaaaaaaaaaO..',
    '...OaaaaaaaaaaaaaaaaaO..',
    '..OaaaaOaaaaaaaaaaaaaO..',
    '..OaaaaOaaaaaaaaaaaammO.',
    '..OaaaaOaaaaaaaaaaaaammO',
    '..OaaOOaaaaaOOaaaaaOOmmO',
    '...OaaO.OaaO.OaaO.OaaOmO',
    '...OaaO.OaaO.OaaO.OaaOmO',
    '.OOOO.OOOO.OOOO.OOOO.OOO',
  ],
  // 玄豹：最低最长的猫科。左上方翘起的长尾（O 勾）+ 全身豹斑（b）+ 兽瞳（e）。
  // 尾巴与斑纹是它和赤兔/猛虎拉开差距的关键——即便缩到很小也读得出「带斑点的长猫」。
  leopard: [
    'O......................O',
    '.OO.................OaO.',
    'O.O...............OaaaO.',
    '.OaaOOOOOOOOOOOOOOOaaaO.',
    '..OaaaaabbaaaaaaaaaaeaO.',
    '.OaabbaabbaabbaabaaaaaO.',
    '.OaaaaaaaaaaaaaaaaaaOO..',
    '.OabbaabbaabbaabaaaaO...',
    '..OaaaaaaaaaaaaaaaaaO...',
    '..OaaOOaaOO.OOaaOOaaO...',
    '..OaO..OaO...OaO.OaO....',
    '..OaO..OaO...OaO.OaO....',
    '..OOO..OOO...OOO.OOO....',
    '........................',
  ],
  // 白额虎：粗黑条纹（b 成排竖带）+ 额上「王」纹脸（aeb/a 交替）+ 白爪（m）。
  // 条纹是密集竖带而非细线，缩图也能读出「虎纹」而非纯色块。
  tiger: [
    '........................',
    '.OO................OOOO.',
    'OaaO..............OaebeO',
    '.OaaOOOOOOOOOOOOOOabebaO',
    '..OaabbaabbaabbaabaaaaaO',
    '.OabbaabbaabbaabbaaaaaO.',
    '.OaaaaaaaaaaaaaaaaaaaOO.',
    '.OabbaabbaabbaabbaaaaO..',
    '.OaaaaaaaaaaaaaaaaaaO...',
    '.OaaOOaaOO.OOaaOOaaaO...',
    '.OmmO.OmmO..OmmO.OmmO...',
    '.OmmO.OmmO..OmmO.OmmO...',
    '.OOOO.OOOO..OOOO.OOOO...',
    '........................',
  ],
  // 赤兔：唯一有「鬃」的坐骑——后颈一排蓬鬃（b 上扬）+ 鞍具（m）+ 红色躯体。
  // 鬃毛向左上炸开，是它和玄豹（斑纹+尾）最直观的区分点。
  redhare: [
    '........................',
    'bbb...............OO....',
    'Obbb...bbbb.......ObaO..',
    '.ObbbOObbbbOOOOOOObaaO..',
    '..OaaaaaaaaaaaaaaaOaeaO.',
    '.OaammmmmaaaaaaaaaaaaaO.',
    '.OaammmmmaaaaaaaaaaaOO..',
    '.OaaaaaaaaaaaaaaaaaO....',
    '.OaaaaaaaaaaaaaaaaaO....',
    '.OaaO.OaaO..OaaO.OaaO...',
    '..OaO..OaO...OaO..OaO...',
    '..OaO..OaO...OaO..OaO...',
    '..OMO..OMO...OMO..OMO...',
    '..OOO..OOO...OOO..OOO...',
  ],
  // 蛮牛：头顶两根包铁角（m/M）向上冲天成 V——全场唯一「向上长出硬结构」的坐骑，
  // 角高过头顶轮廓，骑手坐在背上时仍有两只角戳在头顶上方，辨识度最高。
  ox: [
    '........................',
    '.OO.............Omm..mO.',
    'OaaO............OmOOmOO.',
    '.OaOOOOOOOOOOOOOOOmmmO..',
    '.OaaaaaaaaaaaaaaaOaeaaO.',
    'OaabbbbbbbbbaaaaaOaaaaO.',
    'OaabbbbbbbbbaaaaaOabbaO.',
    'OaaaaaaaaaaaaaaaaOOaaOO.',
    '.OaaaaaaaaaaaaaaaaOOOO..',
    '.OaaOOaaaaOOaaaOOaaO....',
    '.OaaO.OaaO.OaaO.OaaO....',
    '.OaaO.OaaO.OaaO.OaaO....',
    '.OMMO.OMMO.OMMO.OMMO....',
    '.OOOO.OOOO.OOOO.OOOO....',
  ],
};

// ── 敌方补给建筑模板（v2.6 §3）：20×20 ──────────────────────────────
//
// 设计纪律：建筑必须与「单位」在剪影层面彻底分开，否则玩家会把箭楼当成一个站着不动的兵。
// 三条硬规则：
//   1. 建筑一律「底边贴地、左右对称」——生物永远不对称（武器在一侧）。
//   2. 建筑不使用皮肤索引 s/S，永远没有脸。
//   3. 每类建筑给一个「功能可读」的开口：兵营是门帘、箭楼是箭窗、龙巢是蛋、龙穴是洞口。
// 这样玩家扫一眼就能判断「这栋会出兵 / 这栋会打我」，进而决定要不要绕开。
export const BUILDING_TPL_SIZE = 20;

export const BUILDING_TEMPLATES: Record<BuildingKind, string[]> = {
  // 敌营：中式军帐 + 旗杆 + 门帘。旗杆是唯一穿出顶边的竖线，远处也能认出「这里在出兵」
  barracks: [
    '.........O..........',
    '.........OMbbbbO....',
    '.........OMbbbO.....',
    '.........OM.........',
    '....OOOOOOMOOOOOO...',
    '...OaaaaaaMaaaaaaO..',
    '..OaaaaaaaMaaaaaaaO.',
    '.OaaaaaaaaMaaaaaaaaO',
    'OOOOOOOOOOOOOOOOOOOO',
    'OllllllllllllllllllO',
    'OaaaaOOOOOOOOOOaaaaO',
    'OaaaaObbbbbbbbOaaaaO',
    'OaaaaObbbbbbbbOaaaaO',
    'OaaaaObbbbbbbbOaaaaO',
    'OaaaaObbbbbbbbOaaaaO',
    'OaaaaObbbbbbbbOaaaaO',
    'OllllOllllllllOllllO',
    'O####O########O####O',
    'OOOOOOOOOOOOOOOOOOOO',
    '....................',
  ],
  // 木箭楼：顶部火盆（g）+ 飞檐 + 垛口 + 箭窗。最矮最脆，但火盆让它在夜色地图上依然扎眼
  tower_wood: [
    '.........g..........',
    '........OggO........',
    '.......OllllO.......',
    '....OOOllllllOOO....',
    '...OllllllllllllO...',
    '...OOOOOOOOOOOOOO...',
    '....OaaOaaaaOaaO....',
    '....OaaOaaaaOaaO....',
    '....OOOOOOOOOOOO....',
    '.....OllllllllO.....',
    '.....OaaaaaaaaO.....',
    '.....OaObbbbOaO.....',
    '.....OaObbbbOaO.....',
    '.....OaaaaaaaaO.....',
    '.....OllllllllO.....',
    '....OaaaaaaaaaaO....',
    '....OaaaaaaaaaaO....',
    '...OllllllllllllO...',
    '...OOOOOOOOOOOOOO...',
    '....................',
  ],
  // 石砌敌台：整体换成石材索引（M/m），垛口更密、基座更宽。比木楼厚一倍，正面硬拆很亏
  tower_rock: [
    '....................',
    '.......OOOOOO.......',
    '......OMMMMMMO......',
    '....OOMMMMMMMMOO....',
    '...OMMMMMMMMMMMMO...',
    '...OMOOMMOOMMOOMO...',
    '...OMOOMMOOMMOOMO...',
    '...OMMMMMMMMMMMMO...',
    '...OOOOOOOOOOOOOO...',
    '....OaaaaaaaaaaO....',
    '....OaObbbbbbOaO....',
    '....OaObbbbbbOaO....',
    '....OaaaaaaaaaaO....',
    '....OMMMMMMMMMMO....',
    '....OaaaaaaaaaaO....',
    '...OaaaaaaaaaaaaO...',
    '...OaaaaaaaaaaaaO...',
    '..OMMMMMMMMMMMMMMO..',
    '..OOOOOOOOOOOOOOOO..',
    '....................',
  ],
  // 铁铸重楼：顶排铁刺 + 中层熔炉口（g/w）。全场唯一「自己会发光」的建筑，代表它最难拆
  tower_iron: [
    '..O..O..OO..O..O....',
    '..O..O..OO..O..O....',
    '.OOOOOOOOOOOOOOOO...',
    '.OmMmMmMmMmMmMmMO...',
    '.OMmMmMmMmMmMmMmO...',
    '.OOOOOOOOOOOOOOOO...',
    '..OmmOggggggOmmO....',
    '..OmmOgwwwwgOmmO....',
    '..OmmOggggggOmmO....',
    '..OOOOOOOOOOOOOO....',
    '...OMMMMMMMMMMO.....',
    '...OMOmmmmmmOMO.....',
    '...OMOmmmmmmOMO.....',
    '...OMMMMMMMMMMO.....',
    '..OMMMMMMMMMMMMO....',
    '..OMmMmMmMmMmMmO....',
    '..OMMMMMMMMMMMMO....',
    '.OMMMMMMMMMMMMMMO...',
    '.OOOOOOOOOOOOOOOO...',
    '....................',
  ],
  // 龙巢：枝条编成的巢 + 三枚发光龙蛋。蛋的数量 = 幼龙产出上限 3，视觉即规则
  dragon_nest: [
    '....................',
    '....................',
    '....OO...OO...OO....',
    '...OwwO.OwwO.OwwO...',
    '..OwggwOwggwOwggwO..',
    '..OwggwOwggwOwggwO..',
    '..OwwwwOwwwwOwwwwO..',
    '...OwwO.OwwO.OwwO...',
    '....OO...OO...OO....',
    '.OOOOOOOOOOOOOOOOOO.',
    'OllOllOllOllOllOllOO',
    'OaallaallaallaallaaO',
    'OllOllOllOllOllOllOO',
    'OaallaallaallaallaaO',
    'OllOllOllOllOllOllOO',
    '.OaallaallaallaallO.',
    '..OllllllllllllllO..',
    '..OOOOOOOOOOOOOOOO..',
    '....................',
    '....................',
  ],
  // 龙穴：岩壁洞口 + 洞内两只发光竖瞳。占满整块 20×20，是全场体量最大的可摧毁目标
  dragon_lair: [
    '....................',
    '...OOOOOOOOOOOOOO...',
    '..OMMMMMMMMMMMMMMO..',
    '.OMMMMMMMMMMMMMMMMO.',
    'OMMMMOOOOOOOOMMMMMMO',
    'OMMMOggggggggOMMMMMO',
    'OMMOgggwwwwgggOMMMMO',
    'OMMOggwOggOwggOMMMMO',
    'OMMOggwOggOwggOMMMMO',
    'OMMOgggwwwwgggOMMMMO',
    'OMMOggggggggggOMMMMO',
    'OMMOOgggggggOOMMMMMO',
    'OMMMOOgggggOOMMMMMMO',
    'OMMMMOOOOOOOMMMMMMMO',
    'OMMMMMMMMMMMMMMMMMMO',
    'OMMMMMMMMMMMMMMMMMMO',
    'OllllllllllllllllllO',
    'OOOOOOOOOOOOOOOOOOOO',
    '....................',
    '....................',
  ],
};
