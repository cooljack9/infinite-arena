// v2.2 新手模式弹窗教学配置（v2.4 增补「射程与站位」；v2.6 增补「初始装备包 / 白装附魔」）
//
// 设计要点（需求 §8.5 / 开发 §6.7）：
//  · 仅在新手模式（5 层）触发，共 6 个教学组、15 个教学点（每组 2~4 点，见 integration [12]）。
//  · 每个教学点用 anchorId 指向界面上一个真实 DOM 元素（在 Intermission / PreBattle
//    里以 id="tut-*" 标注），教学云朵会定位到该元素旁并画箭头指向它。
//  · 教学点按层 + 屏幕分组，层序为 [1(inter), 1(pre), 2, 3, 4, 5]：
//      - layer 1 含两组（Intermission 讲初始装备/升星/卖出，PreBattle 讲射程与站位）。
//      - layer 2/3/4 的 Intermission 讲合成/附魔/重铸/购买/刷新/词条/击杀成长。
//      - layer 5 的 PreBattle 讲冲刺通关与跳过已通关层（第 5 层胜利即结算，无 Intermission）。
//
// v2.6 §1 装备教学闭环：
//   开局发 2 蓝 + 2 白（store.rollStarterKit），刚好凑齐三条演示链路的素材——
//     · 2 蓝  → 合成台「2 蓝 → 1 橙」升阶（tut-fuse）
//     · 白→蓝 → 锻造工坊「属性转移」把白装词条附魔进蓝装（tut-forge-transfer）
//     · 白装  → 锻造工坊「重铸」随机翻成蓝/橙/红品质（tut-forge-reroll，v3.3 起每层全局 1 次）
//   过去这三条只在玩家「碰巧攒够素材」时才有得点，教学云朵常指向不存在的锚点而退化成
//   居中无箭头的空提示。发初始包 + 补 tut-forge-transfer 锚点 + 合成台标题兜底 id 之后，
//   三条链路在教学期内恒定可演示。
//
// v2.9.4 休整屏三子页改版（需求 ①③）同步：
//   休整屏拆为「中枢页（开箱 / 队伍面板·出售 / 药剂 / 招募 / 建议下一步）+ 三套子页
//   （🎽 穿戴 / 🔥 融合 / 🛒 商店）」，每套子页各带装备筛选（品质 / 含属性 / 排序）。
//   子页是条件渲染的 → tut-inventory / tut-fuse / tut-forge-* / tut-shop-* 只在对应页激活时存在。
//   IntermissionHub 里的 ANCHOR_TAB 表会在教学点推进时自动切到锚点所在子页，
//   TutorialOverlay 则用 rAF 轮询等待锚点挂载后再定位，因此本文件只需按功能写锚点，无需关心切页。
//   层 1 新增一点：「建议下一步 + 三套子页导航」（tut-guide），做渐进披露的入口引导
//   （合成一点而非两点，是为了守住 integration [12]「每组 2~4 个教学点」的上限，也少一次打断）。

import { GameMode } from '../types';

export interface TutorialStep {
  /** 要指向的界面元素 id（在对应屏幕里以 id="tut-*" 标注） */
  anchorId: string;
  /** 标题（如「角色升星」） */
  title: string;
  /** 教学文案 */
  text: string;
  /**
   * 箭头方向覆盖：不填则由 TutorialOverlay 依据锚点相对视口位置自动判定
   *（锚点在上半屏 → 云朵放下方、箭头朝上；锚点在下半屏 → 云朵放上方、箭头朝下）。
   */
  arrow?: 'up' | 'down';
}

export interface TutorialGroup {
  layer: number;
  screen: 'inter' | 'pre';
  steps: TutorialStep[];
}

export const TUTORIAL_MODE: GameMode = 'novice';

export const TUTORIAL: TutorialGroup[] = [
  {
    layer: 1,
    screen: 'inter',
    steps: [
      {
        anchorId: 'tut-guide',
        title: '不知道先干嘛？看这里',
        text: '休整期的操作分成三页：【🎽 穿戴】上装备、【🔥 融合】锻造合成、【🛒 商店】买卖补货，每页都有「品质 / 含属性 / 评分」筛选条。这块【建议下一步】会按当前状态排好序（一键装备 → 一键全买 → 可合成），点绿色按钮直接跳到对应子页，带 ✦ 的那页就是现在最该去的。',
      },
      {
        anchorId: 'tut-inventory',
        title: '初始装备包',
        text: '教学局已经先送你 4 件装备：2 件【蓝装】+ 2 件【白装】。在【🎽 穿戴】页点一下就能穿到当前勇者身上，或用「全队一键装备」按评分自动分发；先别急着全穿，下一层要拿它们演示合成与附魔。',
      },
      {
        anchorId: 'tut-hero-panel',
        title: '角色升星',
        text: '点开勇者的【面板】即可在其中「升星 / 突破」：消耗金币提升星级，满 5★ 后继续升级还能永久突破核心属性。',
      },
      {
        anchorId: 'tut-hero-sell',
        title: '角色卖出',
        text: '不需要的副本点这里的【✕】即可换成金币（队伍至少保留 1 名勇者）。招募能再要一个同名身体，与升星互不影响。',
      },
    ],
  },
  {
    layer: 1,
    screen: 'pre',
    steps: [
      {
        anchorId: 'tut-formation',
        title: '射程与站位',
        text: '选中队员会显示【射程圈】——圈内是他能打到的最远格数。射手/法师射程长，可躲在最后排安全输出；近战射程短，必须贴到敌人脸前。',
      },
      {
        anchorId: 'tut-formation',
        title: '怎么摆',
        text: '坦克堵在正面入口承伤，远程摆在我方最后排、对准敌人最前排，能让射程圈覆盖最多目标。点队员→点绿格即可调整，4 套预设也能一键布阵。',
      },
    ],
  },
  {
    layer: 2,
    screen: 'inter',
    steps: [
      {
        anchorId: 'tut-fuse',
        title: '装备合成（2 蓝 → 1 橙）',
        text: '已经帮你切到【🔥 融合】页。在下方合成台选中开局给的那 2 件【蓝装】，点【合成升阶】就能换成 1 件更高级的橙装。规则是 2 蓝→1 橙、2 橙→1 红、红+红升星（最高 5★），每层限 2 次。装备已穿在身上的话，先回【🎽 穿戴】页点下来。',
      },
      {
        anchorId: 'tut-forge-transfer',
        title: '白装附魔蓝装',
        text: '同在【🔥 融合】页的锻造工坊：【属性转移】＝附魔。① 选一件要保留的【蓝装】当目标，② 再把【白装】选为素材，白装的词条就会按概率转移到蓝装上。两步各有独立筛选条——用「含属性」勾出带你想要词条的素材，命中率一目了然。白值同名累加、百分比同类取最大值；素材无论成败都会销毁。',
      },
      {
        anchorId: 'tut-forge-reroll',
        title: '白装重铸（刷新品质）',
        text: '【重铸】针对白装（普通装备）：一次成型，随机翻成蓝 / 橙 / 红品质（三等分概率），品质和词条同层生效。每层全局只限 1 次——白装多时，优先选最值得翻的那件。',
      },
    ],
  },
  {
    layer: 3,
    screen: 'inter',
    steps: [
      {
        anchorId: 'tut-shop-buy',
        title: '商店购买',
        text: '已经帮你切到【🛒 商店】页。点装备/药剂的【买】即可购入，或直接【一键全买】按价格从低到高扫货（买空还会免费刷新一批）；交易次数越多折扣越深（满 20 次封顶 5 折 off）。买卖两侧都有筛选条，可只看蓝装或只看带某条属性的货。',
      },
      {
        anchorId: 'tut-shop-refresh',
        title: '商店刷新',
        text: '不想买当前这批货？花 1 金币点【刷新】换一批全新库存——随手可用，但仍是取舍。',
      },
    ],
  },
  {
    layer: 4,
    screen: 'inter',
    steps: [
      {
        anchorId: 'tut-inventory',
        title: '装备词条搭配',
        text: '黄色百分比词条比白色数值更稀有，优先把核心属性（生命 / 物伤 / 法伤）的百分比堆满。背包多了就用筛选条的「含属性」只挑带该词条的装，再按「评分」排序，一眼看出该穿哪件。',
      },
      {
        anchorId: 'tut-hero-panel',
        title: '击杀成长',
        text: '战斗中击杀敌人，会让「击杀者」那份副本永久成长（核心 +0.5 / 二级 +1%），越打越强。',
      },
    ],
  },
  {
    layer: 5,
    screen: 'pre',
    steps: [
      {
        anchorId: 'tut-prebattle-start',
        title: '冲刺通关',
        text: '新手模式只有 5 层！打赢这一场即「通关」，正式解锁普通无尽与铁人无尽两种模式。',
      },
      {
        anchorId: 'tut-prebattle-skip',
        title: '跳过已通关层',
        text: '之后挑战深塔时，已经打通过的层数可以一键【跳过】，直接结算为胜利，把精力留给新挑战。',
      },
    ],
  },
];
