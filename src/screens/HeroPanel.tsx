// v1.6 §A.3 角色面板：在商店/招募/背包任意位置都能查看完整数值。
//
// 关键设计：面板不自己算属性，而是直接调用 makeAlly() 走一遍真实的战斗单位构造流程。
// 这条约束是刻意的——只要面板与实战共用同一条计算链，就不可能出现
// 「面板写着 320 攻，进场只有 287」这种最消耗玩家信任的偏差。
// v1.7 §1：面板同时是升星/突破与出售的入口（按 uid 操作这一份副本）。
import { CSSProperties, useState } from 'react';
import { HeroDef, Equipment, PrimaryAttrs, Rarity, GROWTH_STAT_KEYS, PRIMARY_KEYS } from '@arena/core/types';
import { makeAlly, displayName } from '@arena/core/engine/unit';
import { SUBCLASS_INFO, BODY_INFO, skillLevelOf, skillPowerMult } from '@arena/core/content/classes';
import { TRAITS, SKILL_STAGE2 } from '@arena/core/content/traits';
import { AFFIX_POOL, equipDisplayName, eqStarMult } from '@arena/core/content/equipment';
import { MOUNTS, MOUNT_RARITY, rideSummary } from '@arena/core/content/mounts';
import { PERSONALITIES } from '@arena/core/content/personalities';
import { dominantPrimary } from '@arena/core/content/consumables';
import { useGame, BREAKTHROUGH_MAIN_CHANCE } from '../game/state/store';
import ConfirmDialog from './ConfirmDialog';

const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#cfcfcf', blue: '#4aa3ff', orange: '#ff9a3c', red: '#ff4d6d',
};

const PRIMARY_CN: Record<keyof PrimaryAttrs, string> = {
  con: '强壮', str: '力量', agi: '敏捷', int: '智力',
};

const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '1px 0' };
const box: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
  padding: '8px 10px', background: 'rgba(255,255,255,0.035)', flex: '1 1 168px', minWidth: 168,
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={row}>
      <span className="muted">{label}</span>
      <span style={{ color: '#e8e8e8', fontWeight: 600 }}>
        {value}
        {hint && <span style={{ color: '#7ee08a', fontWeight: 500, marginLeft: 4 }}>{hint}</span>}
      </span>
    </div>
  );
}

interface Props {
  hero: HeroDef;
  level: number;
  equipment?: Equipment[];
  /** 预览用：把这几件装备临时加到身上，用于「买之前先看看提升多少」 */
  preview?: Equipment[];
  onClose: () => void;
}

export default function HeroPanel({ hero, level, equipment = [], preview, onClose }: Props) {
  const info = SUBCLASS_INFO[hero.subclass];
  const run = useGame((s) => s.run);
  const gold = useGame((s) => s.gold);
  const sellHero = useGame((s) => s.sellHero);
  const upgradeHero = useGame((s) => s.upgradeHero);
  const rerollMount = useGame((s) => s.rerollMount);
  const tradeCount = useGame((s) => s.tradeCount);
  const recruitCost = useGame((s) => s.recruitCost)();
  // v2.9.3 坐骑刷新费用：500 起、每次 +200、上限 2000
  const rerollCost = Math.min(2000, 500 + 200 * (tradeCount % 8));

  // v1.7 §1：面板内的升星/突破/出售按 uid 操作「这一份副本」，所以取实时队伍状态
  const live = run?.team.find((t) => t.uid === hero.uid) ?? hero;
  const star = live.star ?? 1;
  const bonus = live.bonusPct ?? {};
  const growth = live.growthBonus;
  const hasBonus = Object.values(bonus).some((v) => (v ?? 0) > 0);
  const canUpgrade = gold >= recruitCost;
  const canSell = (run?.team.length ?? 1) > 1;

  // v2.7 §2：出售不可逆，改走二次确认（需求 §2）
  const [confirmSell, setConfirmSell] = useState(false);
  // v3.2 升星动画：角色发光 3s（等待后端回执）
  const [upgrading, setUpgrading] = useState(false);
  const setFxBusy = useGame((s) => s.setFxBusy);
  const setFxBusyWaves = useGame((s) => s.setFxBusyWaves);
  // v2.7 §3：这一份副本的主属性（basePrimary 已被 variateHero 个体化，同名副本可能不同）
  const mainKey = dominantPrimary(live.basePrimary);
  const mainPct = Math.round(BREAKTHROUGH_MAIN_CHANCE * 100);

  const base = makeAlly(live, level, equipment);
  const withPreview = preview && preview.length > 0 ? makeAlly(live, level, [...equipment, ...preview]) : null;

  // 差值：只有预览态才显示，避免常态下满屏 +0 的噪音
  const delta = (a: number, b: number) => {
    const d = Math.round((b - a) * 10) / 10;
    if (Math.abs(d) < 0.05) return undefined;
    return `${d > 0 ? '+' : ''}${d}`;
  };
  const cur = withPreview ?? base;
  const d = base.derived;
  const c = cur.derived;

  const traitDef = live.traitId ? TRAITS[live.traitId] : null;
  const stage2 = SKILL_STAGE2[live.skill.id];
  const bodyInfo = BODY_INFO[cur.bodyType];
  // v3.1 升星强化签名技：面板必须能读到「技能等级 = 星级」的真实收益，
  // 否则玩家仍会以为技能一开局就是满级的
  const skillLv = skillLevelOf(star);
  const skillPow = skillPowerMult(star);
  const skillCdrPct = Math.round((cur.skillCdr ?? 0) * 100);
  const skillCdShown = Math.round(hero.skill.cd * (1 - (cur.skillCdr ?? 0)) * 10) / 10;

  // v1.7 §2 累计成长回执（击杀 / 药剂）
  const PK_CN: Record<string, string> = { con: '强壮', str: '力量', agi: '敏捷', int: '智力' };
  const SK_CN: Record<string, string> = { hp: '生命', pDmg: '物伤', mDmg: '法伤', heal: '治疗' };
  const growthLines: string[] = [];
  for (const k of PRIMARY_KEYS) { const v = growth?.primary?.[k]; if (v) growthLines.push(`${PK_CN[k]}+${v}`); }
  for (const k of GROWTH_STAT_KEYS) { const v = growth?.secondaryPct?.[k]; if (v) growthLines.push(`${SK_CN[k]}+${v}%`); }

  return (
    <div
      onClick={onClose}
      className="overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet hero-panel"
        style={{
          maxWidth: 560,
          border: `1px solid ${info.color}`,
          boxShadow: `0 0 0 1px rgba(0,0,0,0.5), 0 18px 48px rgba(0,0,0,0.6), 0 0 26px ${info.color}33`,
        }}
      >
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: info.color, fontWeight: 800, fontSize: 17 }}>{displayName(live)}</span>
          {/* v3.1：姓名旁的职业称号——名字负责「他是谁」，称号负责「他打什么位置」 */}
          <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>{live.name}</span>
          <span style={{ color: '#ffd24a', letterSpacing: 1 }}>{'★'.repeat(star)}<span style={{ color: '#4a4f5e' }}>{'★'.repeat(5 - star)}</span></span>
          <span className="tag">{info.cn}</span>
          <span className="tag">{bodyInfo.cn}</span>
          {/* v3.1 性格：体型之外的第二条个体差异，决定索敌偏好 */}
          {live.personality && (
            <span
              className="tag"
              style={{
                color: PERSONALITIES[live.personality].color,
                borderColor: `${PERSONALITIES[live.personality].color}66`,
              }}
              title={PERSONALITIES[live.personality].desc}
            >
              {PERSONALITIES[live.personality].cn}
            </span>
          )}
          <span className="tag">{live.gender === 'female' ? '♀ 女' : '♂ 男'}</span>
          <span className="tag">Lv.{level}</span>
          {live.pendingBurst && <span className="tag" style={{ color: '#ff9a3c', borderColor: '#ff9a3c88' }}>⚡ 爆发生效中</span>}
          <button style={{ marginLeft: 'auto', padding: '2px 10px' }} onClick={onClose}>关闭</button>
        </div>

        {/* v1.7 §1：升星 / 突破 / 出售 入口（按 uid 操作这份副本） */}
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            className={'primary' + (upgrading ? ' anim-heroglow' : '')}
            style={{ padding: '3px 10px', fontSize: 12 }}
            disabled={!canUpgrade || upgrading}
            title={canUpgrade ? `花费 ${recruitCost} 金币` : `金币不足（需 ${recruitCost}）`}
            onClick={() => {
              if (upgrading) return;
              setUpgrading(true);                       // 角色发光 3s，等待后端回执
              setFxBusyWaves('正在升星…', '已完成升星'); // 两段波：悬浮提示 + 锁全局交互
              upgradeHero(live.uid);
              setTimeout(() => { setUpgrading(false); setFxBusy(null); }, 1250); // 响应上限 1.25s
            }}
          >
            {upgrading ? '✨ 升星中…' : star < 5 ? `升星 → ${star + 1}★（${recruitCost}）` : `突破 +3~5%（${recruitCost}）`}
          </button>
          <button
            style={{ padding: '3px 10px', fontSize: 12, color: '#ff8a8a' }}
            disabled={!canSell}
            title={canSell ? `出售此副本（返还 ${Math.round(recruitCost * 0.8)} 金币）` : '至少保留 1 名勇者'}
            onClick={() => setConfirmSell(true)}
          >
            ✕ 出售
          </button>
        </div>
        {/* v2.7 §3：满 5★ 后突破的命中分布要在按钮旁写明，否则玩家无法判断这笔钱值不值 */}
        {star >= 5 && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            突破命中：<span style={{ color: '#ffd24a' }}>{mainPct}% 主属性（{PRIMARY_CN[mainKey]}）</span>
            {' / '}{100 - mainPct}% 其余三项均分
          </div>
        )}

        {/* v2.9.3 坐骑面板：品质 + 属性加成表 + 刷新召唤（坐骑无升级系统，不满意只能刷） */}
        {live.mount && (
          <div style={{ ...box, marginTop: 10, width: '100%' }}>
            <div className="subtitle" style={{ marginBottom: 4, display: 'flex', alignItems: 'center' }}>
              坐骑 · {MOUNTS[live.mount].name}
              <span
                style={{
                  color: live.mountRarity ? MOUNT_RARITY[live.mountRarity].color : '#8a8f9e',
                  fontWeight: 800, marginLeft: 6,
                }}
              >
                {live.mountRarity ? MOUNT_RARITY[live.mountRarity].cn : '蓝'}
              </span>
              <button
                style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}
                disabled={gold < rerollCost}
                title={`刷新召唤：重 roll 坐骑种类与品质（${rerollCost} 金币，随交易次数递增）`}
                onClick={() => rerollMount(live.uid)}
              >
                ↻ 刷新召唤（{rerollCost}）
              </button>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>{MOUNTS[live.mount].desc}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: '#ffd24a' }}>
              加成：{rideSummary(live.mount, live.mountRarity)}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              坐骑技：{MOUNTS[live.mount].skill.name}（CD {MOUNTS[live.mount].skill.cd}s）— {MOUNTS[live.mount].skill.desc}
            </div>
          </div>
        )}
        {!live.mount && (
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            升至 5★ 将随机获得一只坐骑（战象/玄豹/白额虎/赤兔/蛮牛，蓝/橙/紫品质）
          </div>
        )}

        {preview && preview.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#7ee08a' }}>
            预览：装上 {preview.map((p) => equipDisplayName(p)).join('、')} 后的数值
          </div>
        )}

        {/* 一级属性 + 突破 + 累计成长 */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <div style={box}>
            <div className="subtitle" style={{ marginBottom: 4 }}>一级属性</div>
            {(Object.keys(PRIMARY_CN) as (keyof PrimaryAttrs)[]).map((k) => (
              <Stat
                key={k}
                label={PRIMARY_CN[k]}
                value={String(Math.round(cur.primary[k]))}
                hint={(bonus[k] ?? 0) > 0 ? `突破 +${bonus[k]}%` : undefined}
              />
            ))}
            {!hasBonus && star < 5 && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                升至 5★ 后，继续升级可触发属性突破
              </div>
            )}
            {growthLines.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#7ee08a' }}>
                累计成长：{growthLines.join('　')}
              </div>
            )}
          </div>

          <div style={box}>
            <div className="subtitle" style={{ marginBottom: 4 }}>核心战力</div>
            <Stat label="生命" value={String(c.hp)} hint={withPreview ? delta(d.hp, c.hp) : undefined} />
            <Stat label="物理伤害" value={String(c.pDmg)} hint={withPreview ? delta(d.pDmg, c.pDmg) : undefined} />
            <Stat label="魔法伤害" value={String(c.mDmg)} hint={withPreview ? delta(d.mDmg, c.mDmg) : undefined} />
            <Stat label="攻速" value={`${c.atkSpeed.toFixed(1)}%`} hint={withPreview ? delta(d.atkSpeed, c.atkSpeed) : undefined} />
            <Stat label="治疗量" value={String(Math.round(c.heal))} hint={withPreview ? delta(d.heal, c.heal) : undefined} />
          </div>

          <div style={box}>
            <div className="subtitle" style={{ marginBottom: 4 }}>暴击与生存</div>
            <Stat label="暴击率" value={`${c.crit.toFixed(2)}%`} hint={withPreview ? delta(d.crit, c.crit) : undefined} />
            <Stat label="暴击伤害" value={`${c.critDmg.toFixed(2)}%`} hint={withPreview ? delta(d.critDmg, c.critDmg) : undefined} />
            <Stat label="物理减伤" value={`${c.pResist.toFixed(2)}%`} hint={withPreview ? delta(d.pResist, c.pResist) : undefined} />
            <Stat label="魔法减伤" value={`${c.mResist.toFixed(2)}%`} hint={withPreview ? delta(d.mResist, c.mResist) : undefined} />
            <Stat label="闪避" value={`${c.dodge.toFixed(2)}%`} hint={withPreview ? delta(d.dodge, c.dodge) : undefined} />
            <Stat label="移速" value={`${c.moveSpeed.toFixed(1)}%`} hint={withPreview ? delta(d.moveSpeed, c.moveSpeed) : undefined} />
          </div>
        </div>

        {/* 特性 */}
        {traitDef && (
          <div style={{ ...box, marginTop: 8, flex: '1 1 auto' }}>
            <div className="subtitle" style={{ marginBottom: 4 }}>
              角色特性 · <span style={{ color: info.color }}>{traitDef.name}</span>
            </div>
            <div style={{ fontSize: 12, color: '#cfd6e4' }}>{traitDef.desc}</div>
            {traitDef.staticMod && (
              <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                常驻加成：
                {Object.entries(traitDef.staticMod).map(([k, v]) => ` ${k} +${v}`).join('　')}
              </div>
            )}
          </div>
        )}

        {/* v3.1 性格（索敌偏好）：不给数值，只改「先打谁」。
            必须独立成块——它是玩家排兵布阵时唯一能预判 AI 行为的依据。 */}
        {live.personality && (
          <div style={{ ...box, marginTop: 8, flex: '1 1 auto' }}>
            <div className="subtitle" style={{ marginBottom: 4 }}>
              性格 ·{' '}
              <span style={{ color: PERSONALITIES[live.personality].color }}>
                {PERSONALITIES[live.personality].cn}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#cfd6e4' }}>{PERSONALITIES[live.personality].desc}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
              只影响索敌优先级，不提供任何属性加成；被嘲讽时以嘲讽为准。
            </div>
          </div>
        )}

        {/* 技能 */}
        <div style={{ ...box, marginTop: 8, flex: '1 1 auto' }}>
          <div className="subtitle" style={{ marginBottom: 4 }}>
            签名技 · <span style={{ color: info.color }}>{hero.skill.name}</span>
            <span style={{ marginLeft: 6, fontWeight: 400, color: '#ffd24a' }}>Lv.{skillLv}</span>
            <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>CD {skillCdShown}s</span>
          </div>
          <div style={{ fontSize: 12, color: '#cfd6e4' }}>{hero.skill.desc}</div>
          {stage2 && (
            <div style={{ fontSize: 12, color: '#ffd24a', marginTop: 3 }}>二段机制：{stage2}</div>
          )}
          {/* v3.1 升星强化技能：把「这一星到底买到了什么」直接写出来 */}
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            技能等级 = 星级：效果 ×{skillPow.toFixed(2)}
            {skillCdrPct > 0 && ` · 冷却 −${skillCdrPct}%`}
            {skillLv < 5 && (
              <span style={{ color: '#ffd24a' }}>
                {'　'}升星 → Lv.{skillLv + 1}（效果 ×{skillPowerMult(skillLv + 1).toFixed(2)}）
              </span>
            )}
          </div>
        </div>

        {/* 体型 */}
        <div style={{ ...box, marginTop: 8, flex: '1 1 auto' }}>
          <div className="subtitle" style={{ marginBottom: 4 }}>体型 · {bodyInfo.cn}（{bodyInfo.trait}）</div>
          <div style={{ fontSize: 12, color: '#cfd6e4' }}>{bodyInfo.traitDesc}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            生命 ×{bodyInfo.hpMult} · 移速 ×{bodyInfo.msMult} · 闪避 {bodyInfo.dodgeBonus >= 0 ? '+' : ''}{bodyInfo.dodgeBonus}
          </div>
        </div>

        {/* 已穿戴装备 */}
        <div style={{ ...box, marginTop: 8, flex: '1 1 auto' }}>
          <div className="subtitle" style={{ marginBottom: 4 }}>已穿戴 {equipment.length}/6</div>
          {equipment.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>暂无装备</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {equipment.map((e) => {
                const sm = eqStarMult(e);
                return (
                  <div
                    key={e.id}
                    style={{
                      border: `1px solid ${RARITY_COLOR[e.rarity]}`, borderRadius: 6,
                      padding: '4px 6px', fontSize: 11, minWidth: 128,
                    }}
                  >
                    <div style={{ color: RARITY_COLOR[e.rarity], fontWeight: 700 }}>{equipDisplayName(e)}</div>
                    {e.affixes.map((a, i) => (
                      <div key={i} style={{ color: a.mode === 'pct' ? '#ffd24a' : '#cfd6e4' }}>
                        {AFFIX_POOL[a.key].name} {a.value >= 0 ? '+' : ''}
                        {a.mode === 'pct'
                          ? `${Math.round(a.value * sm)}%`
                          : Math.round(a.value * sm)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* v2.7 §2 出售二次确认（嵌在面板内部，借面板的 stopPropagation 避免误关）*/}
        {confirmSell && (
          <ConfirmDialog
            title={`确认出售「${displayName(live)}」？`}
            body={
              <>
                该副本将<b style={{ color: '#ff8a8a' }}>永久离队</b>，其 {star}★ 星级、突破加成
                {live.mount ? '、已解锁的坐骑' : ''}
                {growthLines.length > 0 ? '、累计成长' : ''}
                <b style={{ color: '#ff8a8a' }}>一并消失，无法找回</b>。
                <br />
                · 返还金币：<b style={{ color: '#ffd24a' }}>{Math.round(recruitCost * 0.8)}</b>
                （招募价 {recruitCost} 的 80%）
                <br />
                · 身上 <b>{equipment.length}</b> 件装备会卸回背包
              </>
            }
            confirmLabel="确认出售"
            onConfirm={() => { setConfirmSell(false); sellHero(live.uid); onClose(); }}
            onCancel={() => setConfirmSell(false)}
          />
        )}
      </div>
    </div>
  );
}
