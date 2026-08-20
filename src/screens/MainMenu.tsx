import { useState } from 'react';
import { useGame } from '../game/state/store';
import { INTRO } from '@arena/core/content/story';
import { GameMode } from '@arena/core/types';
import { readSaveMeta, deleteSave, SAVE_SLOTS, type SaveSlotId, type SaveMeta } from '../game/saves';
import { isRemoteMode } from '../backend/storeBridge';
import Codex from './Codex';
import ConfirmDialog from './ConfirmDialog';
import { toast } from '../components/Toast';

const MODE_CN: Record<string, string> = { novice: '新手', normal: '普通无尽', ironman: '铁人无尽' };
const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function MainMenu() {
  const best = useGame((s) => s.bestLayer);
  const setScreen = useGame((s) => s.setScreen);
  const endlessUnlocked = useGame((s) => s.endlessUnlocked);
  const selectedMode = useGame((s) => s.selectedMode);
  const setSelectedMode = useGame((s) => s.setSelectedMode);
  const colorblind = useGame((s) => s.colorblind);
  const setColorblind = useGame((s) => s.setColorblind);
  const renderQuality = useGame((s) => s.renderQuality);
  const setRenderQuality = useGame((s) => s.setRenderQuality);
  const activeSlot = useGame((s) => s.activeSlot);
  const setActiveSlot = useGame((s) => s.setActiveSlot);
  const loadSlot = useGame((s) => s.loadSlot);
  const bindSlot = useGame((s) => s.bindSlot);
  const [showStory, setShowStory] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  // v3.3 删除存档走应用内二次确认，不用原生 confirm（UX-3）
  const [confirmDel, setConfirmDel] = useState<SaveSlotId | null>(null);
  // v1.8.3 三存档：本地状态控制重渲染（localStorage 变化不触发 zustand）
  const [, force] = useState(0);
  const refresh = () => force((v) => v + 1);

  const slots: (SaveMeta | null)[] = SAVE_SLOTS.map((s) => readSaveMeta(s));

  const onContinue = (slot: SaveSlotId) => {
    const ok = loadSlot(slot);
    if (!ok) toast(isRemoteMode() ? '云端模式请从线上入口继续（本地槽仅本地模式可用）' : '存档读取失败', 'warn');
  };
  const onDelete = (slot: SaveSlotId) => setConfirmDel(slot);
  const doDelete = (slot: SaveSlotId) => {
    setConfirmDel(null);
    deleteSave(slot);
    if (activeSlot === slot) setActiveSlot(null);
    refresh();
  };

  // v2.2：普通无尽 / 铁人无尽 未解锁时禁止选中（新手通关后才开放）
  const pickMode = (m: GameMode) => {
    if ((m === 'normal' || m === 'ironman') && !endlessUnlocked) return;
    setSelectedMode(m);
  };

  return (
    <div className="app">
      <div className="panel accent col center">
        <div className="title title-hero">无限勇者竞技场</div>
        <div className="subtitle">三人起队 · 七人满编 · 挑战无尽层</div>
        <div className="row center" style={{ marginTop: 8 }}>
          <span className="chip">最佳：第 {best} 层</span>
        </div>

        {/* v2.2 模式选择：新手模式（10 层教学战役）/ 普通无尽（深塔 500 层）/ 铁人无尽（深塔 500 层 · 阵亡永久消失）。
            v1.2 升级为分段控件（.seg），比三个并列按钮更有"单选"质感，键盘可达。 */}
        <div className="col" style={{ marginTop: 12, gap: 6, width: '100%' }}>
          <div className="subtitle" style={{ margin: 0 }}>
            选择模式
            {endlessUnlocked && <span className="tag" style={{ marginLeft: 6, color: '#7ee08a', borderColor: '#7ee08a55' }}>无尽已解锁</span>}
          </div>
          <div className="seg" role="radiogroup" aria-label="游戏模式">
            <button
              type="button"
              role="radio"
              aria-checked={selectedMode === 'novice'}
              className="seg-btn"
              onClick={() => pickMode('novice')}
            >
              新手模式
              <small>10 层教学战役 · 通关解锁无尽</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={selectedMode === 'normal'}
              className="seg-btn"
              style={{ opacity: endlessUnlocked ? 1 : 0.5 }}
              disabled={!endlessUnlocked}
              title={endlessUnlocked ? '深塔挑战，至 500 层登顶' : '通关新手模式后解锁'}
              onClick={() => pickMode('normal')}
            >
              普通无尽 {endlessUnlocked ? '' : '🔒'}
              <small>{endlessUnlocked ? '深塔 · 至 500 层登顶' : '通关新手模式后解锁'}</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={selectedMode === 'ironman'}
              className="seg-btn"
              style={{ opacity: endlessUnlocked ? 1 : 0.5 }}
              disabled={!endlessUnlocked}
              title={endlessUnlocked ? '深塔挑战，阵亡角色永久消失' : '通关新手模式后解锁'}
              onClick={() => pickMode('ironman')}
            >
              铁人无尽 {endlessUnlocked ? '' : '🔒'}
              <small>{endlessUnlocked ? '阵亡永久消失 · 至 500 层' : '通关新手模式后解锁'}</small>
            </button>
          </div>
        </div>

        {/* v2.9.8 无障碍：色盲友好双通道。战场默认只用「蓝=我方 / 红=敌方」一个颜色通道，
            红绿色盲玩家在混战里分不清敌我。开启后追加与颜色无关的形状通道（▲我方 / ▼敌方
            + 我方实线脚环、敌方虚线脚环），血条同步换成蓝/橙安全色。设置随账号持久化。 */}
        <div className="col" style={{ marginTop: 12, gap: 4, width: '100%' }}>
          <div className="subtitle" style={{ margin: 0 }}>无障碍</div>
          <button
            className={'toggle' + (colorblind ? ' toggle--on' : '')}
            aria-pressed={colorblind}
            title="用形状（▲我方 / ▼敌方）叠加颜色区分阵营，适配红绿色盲"
            onClick={() => setColorblind(!colorblind)}
          >
            色盲友好双通道：{colorblind ? '已开启 ✓' : '关闭'}
            <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85 }}>
              ▲ 我方（实线脚环）· ▼ 敌方（虚线脚环）· 血条蓝/橙安全色
            </div>
          </button>
        </div>

        {/* vX 渲染质量档位：高（拉满粒子/暴击辉光） / 标准 / 省电（降粒子、关阴影）。账号级持久化。 */}
        <div className="col" style={{ marginTop: 12, gap: 4, width: '100%' }}>
          <div className="subtitle" style={{ margin: 0 }}>渲染质量</div>
          <div className="seg" role="radiogroup" aria-label="渲染质量">
            {([['high', '高画质'], ['standard', '标准'], ['low', '省电']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={renderQuality === v}
                className="seg-btn"
                onClick={() => setRenderQuality(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 10 }}>
            省电模式减少背景粒子并关闭暴击外发光，低配设备更流畅
          </div>
        </div>

        <button className="primary" style={{ marginTop: 12 }} onClick={() => setScreen('team')}>
          开始挑战（{selectedMode === 'novice' ? '新手模式' : selectedMode === 'normal' ? '普通无尽' : '铁人无尽'}）
        </button>

        {/* v1.8.3 三存档：3 个槽位卡片（本地模式；自动保存在战斗结算后） */}
        <div className="col" style={{ marginTop: 12, gap: 6, width: '100%' }}>
          <div className="subtitle" style={{ margin: 0 }}>存档（3 个槽位 · 本机）</div>
          <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
            {SAVE_SLOTS.map((slot) => {
              const meta = slots[slot];
              const isActive = activeSlot === slot;
              return (
                <div
                  key={slot}
                  className="card"
                  style={{
                    flex: '1 1 0', minWidth: 0,
                    borderColor: isActive ? 'var(--accent)' : undefined,
                    boxShadow: isActive ? 'var(--glow-accent)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span className="tag" style={{ color: isActive ? '#ffd24a' : undefined, whiteSpace: 'nowrap' }}>
                      存档 {slot + 1}{isActive ? ' ●' : ''}
                    </span>
                    {meta && <span className="muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{fmtTime(meta.savedAt)}</span>}
                  </div>
                  {meta ? (
                    <>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        {MODE_CN[meta.mode] ?? meta.mode} · 第 {meta.layer} 层 · {meta.score} 分
                      </div>
                      <div className="muted" style={{ fontSize: 10, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {meta.teamNames.join('、')}
                      </div>
                      <div className="row" style={{ gap: 4, marginTop: 6 }}>
                        <button className="primary" style={{ padding: '3px 8px', fontSize: 11, flex: 1 }} onClick={() => onContinue(slot)}>
                          继续
                        </button>
                        <button style={{ padding: '3px 6px', fontSize: 11 }} title="覆盖此存档开始新挑战" onClick={() => bindSlot(slot)}>
                          新开
                        </button>
                        <button style={{ padding: '3px 6px', fontSize: 11, color: '#ff8a8a' }} onClick={() => onDelete(slot)}>
                          删
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>空存档位</div>
                      <button className="ghost" style={{ padding: '3px 8px', fontSize: 11, marginTop: 6, width: '100%' }} onClick={() => bindSlot(slot)}>
                        新游戏到此槽
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 10, textAlign: 'left' }}>
            存档保存在本机浏览器；自动保存在战斗结算后。云端模式进度由账号保留，本地槽仅本地模式使用。
          </div>
        </div>
        <button style={{ marginTop: 8 }} onClick={() => setShowStory((v) => !v)}>
          {showStory ? '收起背景故事 ▲' : '背景故事 ▾'}
        </button>
        {showStory && (
          <div
            style={{
              marginTop: 10,
              textAlign: 'left',
              fontSize: 13,
              lineHeight: 1.75,
              color: '#cfd6e4',
              borderTop: '1px solid rgba(255,255,255,0.12)',
              paddingTop: 10,
            }}
          >
            {INTRO}
          </div>
        )}
        <button style={{ marginTop: 8 }} onClick={() => setShowHelp((v) => !v)}>
          {showHelp ? '收起玩法说明 ▲' : '玩法说明（体型 / 性别）▾'}
        </button>
        {showHelp && (
          <div
            style={{
              marginTop: 10,
              textAlign: 'left',
              fontSize: 13,
              lineHeight: 1.75,
              color: '#cfd6e4',
              borderTop: '1px solid rgba(255,255,255,0.12)',
              paddingTop: 10,
            }}
          >
            <b style={{ color: '#ffcc4d' }}>体型（每局随机）</b>：从「侏儒 / 精巧」（小巧·移速与闪避极高）
            到「巨灵 / 泰坦」（庞大·血量与压迫感极强），共 10 档。大体型免疫击退、小体型更难被远程瞄准——
            没有最好的体型，只有最契合阵容的体型。角色面板里的「体型」标签会写明本档特性。
            <br />
            <b style={{ color: '#ffcc4d' }}>性别（每局随机）</b>：女性攻速与暴击更高，外形为长发；
            男性爆伤与生命更高，外形为方颌短须。外形一眼可辨，属性差异在结算与面板中体现。
          </div>
        )}
        <div className="subtitle" style={{ marginTop: 8 }}>
          挑战杯模式 · Roguelike 无尽竞技场
        </div>

        {/* v2.10 图鉴 + 教学重置（UX-6 / UX-8） */}
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button style={{ flex: 1, whiteSpace: 'nowrap' }} onClick={() => setShowCodex(true)}>📖 图鉴</button>
          <button
            style={{ flex: 1, whiteSpace: 'nowrap' }}
            title="清除「不再显示教学」，下局进入新手模式会重新弹出教学"
            onClick={() => {
              try {
                localStorage.removeItem('arena_tutorial_disabled');
                toast('已重置新手教学：下局进入新手模式将重新弹出教学。', 'ok');
              } catch {
                /* ignore */
              }
            }}
          >
            ↺ 重置教学
          </button>
        </div>
      </div>

      {showCodex && <Codex onClose={() => setShowCodex(false)} />}

      {confirmDel !== null && (
        <ConfirmDialog
          title="删除存档"
          body={
            <span>
              确认删除<b style={{ color: '#ff8a8a' }}> 存档 {confirmDel + 1} </b>
              吗？该局进度将无法恢复。
            </span>
          }
          confirmLabel="删除存档"
          danger
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => doDelete(confirmDel)}
        />
      )}
    </div>
  );
}
