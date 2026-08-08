// 战前布阵编辑器（v2.3 需求：战斗开始前要能调整站位）
//
// 交互取「点选 + 落点」而非拖拽：拖拽在 22px 的格子上误差太大，
// 而且触屏/触控板拖拽的取消语义很难做对。点选两步是最不会错的方案。
//   · 点棋子 → 选中（再点自己 = 取消）
//   · 选中后点空的绿格 → 移动
//   · 选中后点另一个棋子 → 两人交换位置
// 选中时叠加该角色的攻击射程圈，让「站位」这件事有可读的决策依据，
// 否则玩家只是在无信息地拖方块。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArenaDef, HeroDef, Vec2 } from '@arena/core/types';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { MAP_THEMES, fadeColor } from '@arena/core/content/arenas';
import { drawSprite } from '../render/sprites';
import { displayName } from '@arena/core/engine/unit';
import { PERSONALITIES } from '@arena/core/content/personalities';
import {
  FORMATION_PRESETS, FormationPreset, cellKey, isDeployable, presetFormation, toPos,
} from '@arena/core/gen/formation';

// v3.2：28 → 更大棋子。26px 时剪影+姓名在低分辨率下偏小，放大到 28px
//（20 列宽约 560px，仍在一屏内）；姓名条同步放大到 12px。
const CELL = 28;

// v3.1 危险地形在部署页也要可见——玩家是在这张图上决定站位的，
// 战斗时才发现脚下是岩浆等于布阵信息不完整。配色与 frame.ts::drawTile 对齐。
const HAZARD_FALLBACK = '#05030a';
const LAVA_BASE = '#4a1508';
const LAVA_CORE = 'rgba(255,110,40,0.30)';

/** 图例色块 */
function LegendSwatch(
  { color, border, label, round }: { color: string; border?: string; label: string; round?: boolean },
) {
  return (
    <span className="row" style={{ gap: 4, alignItems: 'center' }}>
      <span
        style={{
          width: 11, height: 11, background: color, borderRadius: round ? '50%' : 2,
          border: border ? `1px solid ${border}` : '1px solid rgba(255,255,255,0.18)',
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

/** 单个棋子：职业专属像素剪影（含体型/性别/星级）+ 中间的姓名 */
function HeroToken({ hero, selected }: { hero: HeroDef; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const info = SUBCLASS_INFO[hero.subclass];
  const body = hero.bodyType ?? info.defaultBody;
  const star = hero.star ?? 1;

  // 画布比格子高 8px 并上溢，让 2★+ 的头顶星级有地方画（drawSprite 把星画在 cy-size/2-4）
  const CW = CELL, CH = CELL + 8;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(CW * dpr);
    cv.height = Math.round(CH * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    // cy 往下压 1px：给顶部星级留净空，同时把剪影推到姓名条上方
    drawSprite(ctx, hero.subclass, CW / 2, 8 + CELL / 2 - 2, CELL * 0.74, false, {
      bodyType: body, gender: hero.gender, star,
    });
  }, [hero.subclass, body, hero.gender, star, CW, CH]);

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        // 职业专属底色（低透明）：一眼分辨职业，又不盖住剪影
        background: `${info.color}2e`,
        borderRadius: 3,
        border: selected ? '2px solid #fff' : `1px solid ${info.color}aa`,
        boxShadow: selected ? `0 0 10px ${info.color}` : '0 1px 0 rgba(0,0,0,0.5)',
        overflow: 'visible',
      }}
    >
      <canvas
        ref={ref}
        width={CW}
        height={CH}
        style={{ position: 'absolute', left: 0, top: -8, width: CW, height: CH, pointerEvents: 'none' }}
      />
      <span
        style={{
          position: 'absolute', left: -6, right: -6, bottom: 0,
          fontSize: 12, lineHeight: '14px', fontWeight: 800, textAlign: 'center',
          color: '#fff',
          background: 'rgba(6,8,14,0.72)',
          textShadow: '0 1px 0 #000',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip',
          pointerEvents: 'none', borderRadius: 3, padding: '1px 0',
        }}
      >
        {displayName(hero)}
      </span>
    </div>
  );
}

interface Props {
  arena: ArenaDef;
  team: HeroDef[];
  anchor?: Vec2;
  /** uid -> tile 中心坐标 */
  value: Record<string, Vec2>;
  onChange: (v: Record<string, Vec2>) => void;
  preset: FormationPreset;
  onPreset: (p: FormationPreset) => void;
  /** 敌方开场落点预览（只读红点） */
  enemyPreview?: Vec2[];
  bossPos?: Vec2;
}

export default function FormationEditor({
  arena, team, anchor, value, onChange, preset, onPreset, enemyPreview = [], bossPos,
}: Props) {
  const [sel, setSel] = useState<string | null>(null);

  const theme = MAP_THEMES[arena.theme ?? 'sandstone'];
  const fade = arena.fade ?? 0;
  const col = (hex: string) => fadeColor(hex, fade);

  // cellKey -> uid，用于 O(1) 查某格站着谁
  const occupant = useMemo(() => {
    const m: Record<string, string> = {};
    for (const h of team) {
      const p = value[h.uid];
      if (p) m[cellKey(Math.floor(p.x), Math.floor(p.y))] = h.uid;
    }
    return m;
  }, [team, value]);

  const enemyCells = useMemo(() => {
    const s = new Set<string>();
    for (const p of enemyPreview) s.add(cellKey(Math.floor(p.x), Math.floor(p.y)));
    return s;
  }, [enemyPreview]);

  const clickCell = (c: number, r: number) => {
    const key = cellKey(c, r);
    const here = occupant[key];

    if (here) {
      if (!sel) { setSel(here); return; }
      if (sel === here) { setSel(null); return; }
      // 交换
      const a = value[sel];
      const b = value[here];
      if (a && b) onChange({ ...value, [sel]: b, [here]: a });
      setSel(null);
      return;
    }

    if (!sel) return;
    if (!isDeployable(arena, c, r)) return;
    onChange({ ...value, [sel]: toPos(c, r) });
    setSel(null);
  };

  const applyPreset = (p: FormationPreset) => {
    const pts = presetFormation(arena, anchor, team.length, p);
    const next: Record<string, Vec2> = {};
    team.forEach((h, i) => { next[h.uid] = pts[i]; });
    onChange(next);
    onPreset(p);
    setSel(null);
  };

  const selHero = sel ? team.find((h) => h.uid === sel) : undefined;
  const selPos = sel ? value[sel] : undefined;
  const selInfo = selHero ? SUBCLASS_INFO[selHero.subclass] : undefined;

  const rows = arena.tiles.length;
  const cols = arena.width;

  // 图例按需展示：扫一遍 tilemap 看这张图到底有哪些地形
  const terrain = useMemo(() => {
    const all = arena.tiles.join('');
    return {
      prop: all.includes('P'),
      lava: all.includes('M'),
      void: all.includes('~'),
      boss: all.includes('B'),
    };
  }, [arena]);

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <span className="tag">
          {sel
            ? `已选中「${selHero ? displayName(selHero) : ''}」→ 点绿色格子移动，或点另一名队员交换`
            : '点击队员选中，再点绿色区域调整站位'}
        </span>
        <div className="row" style={{ gap: 4 }}>
          {(Object.keys(FORMATION_PRESETS) as FormationPreset[]).map((p) => (
            <button
              key={p}
              className={preset === p ? 'primary' : 'ghost'}
              style={{ padding: '4px 10px', fontSize: 12 }}
              title={FORMATION_PRESETS[p].desc}
              onClick={() => applyPreset(p)}
            >
              {FORMATION_PRESETS[p].cn}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${CELL}px)`,
          gridAutoRows: `${CELL}px`,
          gap: 1,
          padding: 6,
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 6,
          // 关键：网格按内容宽度贴合（fit-content），这样网格轨道从 padding 盒左侧 0 起排，
          // 上方叠加的绝对定位射程圈（left:6 + c*(CELL+1)）才能与真实格子中心对齐；
          // 再用 alignSelf 在 .col 内水平居中，避免 justify-content 把轨道右移导致"射程圈偏左"。
          width: 'fit-content',
          alignSelf: 'center',
          // v2.9.10 移动端：格子是固定 22px，大地图（28+ 宽）在手机上会超过视口。
          // 用 maxWidth:100% + overflow-x:auto 让网格自身横向滚动，而非撑破整页布局；
          // 射程圈是网格内部绝对定位，会随内容一起滚动，对齐关系不变。
          maxWidth: '100%',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          userSelect: 'none',
        }}
      >
        {Array.from({ length: rows }).flatMap((_, r) =>
          Array.from({ length: cols }).map((__, c) => {
            const key = cellKey(c, r);
            const ch = arena.tiles[r]?.[c] ?? '#';
            const deployable = isDeployable(arena, c, r);
            const uid = occupant[key];
            const hero = uid ? team.find((h) => h.uid === uid) : undefined;
            const info = hero ? SUBCLASS_INFO[hero.subclass] : undefined;
            const isEnemy = enemyCells.has(key);
            const isBoss = !!bossPos && Math.floor(bossPos.x) === c && Math.floor(bossPos.y) === r;

            let bg = (c + r) % 2 === 0 ? col(theme.floorA) : col(theme.floorB);
            let hazard: 'void' | 'lava' | null = null;
            if (ch === '#') bg = col(theme.wall);
            else if (ch === 'P') bg = col(theme.prop);
            else if (ch === '~') {
              // 楚河汉界=水蓝 / 八角笼=岩浆红 / 默认虚空黑，与战斗画面同源
              bg = arena.hazardBase ?? HAZARD_FALLBACK;
              hazard = 'void';
            } else if (ch === 'M') {
              bg = LAVA_BASE;
              hazard = 'lava';
            } else if (ch === 'B') bg = '#5a2a1c';

            const tip = hero
              ? `${displayName(hero)}（${SUBCLASS_INFO[hero.subclass].cn}）${
                  hero.personality ? ` · ${PERSONALITIES[hero.personality].cn}：${PERSONALITIES[hero.personality].hint}` : ''
                }`
              : ch === 'M' ? '岩浆：可通行，每秒灼烧 3% 最大生命'
              : ch === '~' ? '深水／虚空：不可通行'
              : ch === 'P' ? '掩体：阻挡移动与射线'
              : ch === 'B' ? 'Boss 台'
              : deployable ? '可部署' : '';

            return (
              <div
                key={key}
                onClick={() => clickCell(c, r)}
                title={tip}
                style={{
                  position: 'relative',
                  // 棋子的星级/姓名条会溢出格子，必须抬 z 轴，否则被右侧/下方格子盖住
                  zIndex: hero ? 2 : undefined,
                  background: bg,
                  cursor: hero || (sel && deployable) ? 'pointer' : 'default',
                  boxShadow: deployable && !hero
                    ? `inset 0 0 0 1px rgba(90,230,140,${sel ? 0.55 : 0.22})`
                    : undefined,
                  outline: deployable && !hero && sel ? '1px solid rgba(90,230,140,0.35)' : undefined,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* 危险地形纹理：虚空/河=波纹双线，岩浆=熔光核心。静态即可，
                    部署页不需要动画，但必须让"这格有毒"在一眼之内成立 */}
                {hazard === 'void' && (
                  <span
                    style={{
                      position: 'absolute', inset: 0, pointerEvents: 'none',
                      background: `repeating-linear-gradient(180deg, transparent 0 4px, ${
                        arena.hazardWave ?? 'rgba(120,200,255,0.30)'
                      } 4px 5px, transparent 5px 9px)`,
                    }}
                  />
                )}
                {hazard === 'lava' && (
                  <>
                    <span
                      style={{
                        position: 'absolute', inset: 4, pointerEvents: 'none',
                        background: LAVA_CORE, borderRadius: 2,
                      }}
                    />
                    <span
                      style={{
                        position: 'absolute', inset: 0, pointerEvents: 'none',
                        background:
                          'repeating-linear-gradient(180deg, transparent 0 5px, rgba(255,140,60,0.5) 5px 6px, transparent 6px 11px)',
                      }}
                    />
                  </>
                )}
                {deployable && !hero && (
                  <span style={{ width: 3, height: 3, background: 'rgba(120,255,170,0.5)' }} />
                )}
                {isEnemy && !hero && (
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: isBoss ? '#ff2e2e' : 'rgba(255,90,90,0.85)',
                      boxShadow: isBoss ? '0 0 8px #ff2e2e' : undefined,
                    }}
                  />
                )}
                {hero && info && <HeroToken hero={hero} selected={sel === uid} />}
              </div>
            );
          }),
        )}

        {/* 选中角色的攻击射程圈：叠在网格上，纯展示不吃点击 */}
        {selPos && selInfo && (
          <div
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              zIndex: 1, // 压在地块之上、棋子（z=2）之下
              left: 6 + Math.floor(selPos.x) * (CELL + 1) + CELL / 2,
              top: 6 + Math.floor(selPos.y) * (CELL + 1) + CELL / 2,
              width: selInfo.attackRange * 2 * (CELL + 1),
              height: selInfo.attackRange * 2 * (CELL + 1),
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: `1px dashed ${selInfo.color}`,
              background: `${selInfo.color}12`,
            }}
          />
        )}
      </div>

      {/* 地形图例：只列这张图真实存在的地形，避免图例比地图还长 */}
      <div
        className="row"
        style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap', fontSize: 11, opacity: 0.85 }}
      >
        <LegendSwatch color="rgba(90,230,140,0.28)" border="rgba(90,230,140,0.6)" label="可部署" />
        {terrain.prop && <LegendSwatch color={col(theme.prop)} label="掩体" />}
        {terrain.lava && <LegendSwatch color={LAVA_BASE} border="rgba(255,140,60,0.7)" label="岩浆 · 每秒 −3% 生命" />}
        {terrain.void && (
          <LegendSwatch
            color={arena.hazardBase ?? HAZARD_FALLBACK}
            border={arena.hazardWave ?? 'rgba(120,200,255,0.5)'}
            label={arena.hazardBase === '#3a0d05' ? '熔岩深渊 · 不可通行' : '深水／虚空 · 不可通行'}
          />
        )}
        {terrain.boss && <LegendSwatch color="#5a2a1c" label="Boss 台" />}
        <LegendSwatch color="rgba(255,90,90,0.85)" label="敌方落点" round />
      </div>

      <div className="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {team.map((h) => {
          const info = SUBCLASS_INFO[h.subclass];
          const pi = h.personality ? PERSONALITIES[h.personality] : undefined;
          return (
            <span
              key={h.uid}
              onClick={() => setSel(sel === h.uid ? null : h.uid)}
              className="chip"
              title={pi ? `${pi.cn}：${pi.desc}` : undefined}
              style={{
                cursor: 'pointer',
                borderColor: sel === h.uid ? info.color : undefined,
                color: info.color,
                boxShadow: sel === h.uid ? `0 0 8px ${info.color}66` : undefined,
              }}
            >
              {displayName(h)} · {info.cn} · 射程 {info.attackRange}
              {pi && (
                <span style={{ color: pi.color, marginLeft: 6 }}>· {pi.cn}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
