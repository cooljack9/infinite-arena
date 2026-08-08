import { useState } from 'react';
import { useGame } from '../game/state/store';
import { INTRO } from '@arena/core/content/story';
import { GameMode } from '@arena/core/types';

export default function MainMenu() {
  const best = useGame((s) => s.bestLayer);
  const setScreen = useGame((s) => s.setScreen);
  const endlessUnlocked = useGame((s) => s.endlessUnlocked);
  const selectedMode = useGame((s) => s.selectedMode);
  const setSelectedMode = useGame((s) => s.setSelectedMode);
  const colorblind = useGame((s) => s.colorblind);
  const setColorblind = useGame((s) => s.setColorblind);
  const [showStory, setShowStory] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // v2.2：普通无尽 / 铁人无尽 未解锁时禁止选中（新手通关后才开放）
  const pickMode = (m: GameMode) => {
    if ((m === 'normal' || m === 'ironman') && !endlessUnlocked) return;
    setSelectedMode(m);
  };

  return (
    <div className="app">
      <div className="panel col center">
        <div className="title">无限勇者竞技场</div>
        <div className="subtitle">三人起队 · 七人满编 · 挑战无尽层</div>
        <div className="row center" style={{ marginTop: 8 }}>
          <span className="chip">最佳：第 {best} 层</span>
        </div>

        {/* v2.2 模式选择：新手模式（5 层教学战役）/ 普通无尽（深塔 500 层）/ 铁人无尽（深塔 500 层 · 阵亡永久消失） */}
        <div className="col" style={{ marginTop: 12, gap: 6, width: '100%' }}>
          <div className="subtitle" style={{ margin: 0 }}>
            选择模式
            {endlessUnlocked && <span className="tag" style={{ marginLeft: 6, color: '#7ee08a', borderColor: '#7ee08a55' }}>无尽已解锁</span>}
          </div>
          <div className="row center" style={{ gap: 8 }}>
            <button
              className={selectedMode === 'novice' ? 'primary mode-btn' : 'mode-btn'}
              style={{ flex: 1, padding: '8px 10px' }}
              onClick={() => pickMode('novice')}
            >
              新手模式
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85 }}>5 层教学战役 · 通关解锁无尽</div>
            </button>
            <button
              className={selectedMode === 'normal' ? 'primary mode-btn' : 'mode-btn'}
              style={{ flex: 1, padding: '8px 10px', opacity: endlessUnlocked ? 1 : 0.5 }}
              disabled={!endlessUnlocked}
              title={endlessUnlocked ? '深塔挑战，至 500 层登顶' : '通关新手模式后解锁'}
              onClick={() => pickMode('normal')}
            >
              普通无尽 {endlessUnlocked ? '' : '🔒'}
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85 }}>
                {endlessUnlocked ? '深塔 · 至 500 层登顶' : '通关新手模式后解锁'}
              </div>
            </button>
            <button
              className={selectedMode === 'ironman' ? 'primary mode-btn' : 'mode-btn'}
              style={{ flex: 1, padding: '8px 10px', opacity: endlessUnlocked ? 1 : 0.5 }}
              disabled={!endlessUnlocked}
              title={endlessUnlocked ? '深塔挑战，阵亡角色永久消失' : '通关新手模式后解锁'}
              onClick={() => pickMode('ironman')}
            >
              铁人无尽 {endlessUnlocked ? '' : '🔒'}
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85 }}>
                {endlessUnlocked ? '阵亡永久消失 · 至 500 层' : '通关新手模式后解锁'}
              </div>
            </button>
          </div>
        </div>

        {/* v2.9.8 无障碍：色盲友好双通道。战场默认只用「蓝=我方 / 红=敌方」一个颜色通道，
            红绿色盲玩家在混战里分不清敌我。开启后追加与颜色无关的形状通道（▲我方 / ▼敌方
            + 我方实线脚环、敌方虚线脚环），血条同步换成蓝/橙安全色。设置随账号持久化。 */}
        <div className="col" style={{ marginTop: 12, gap: 4, width: '100%' }}>
          <div className="subtitle" style={{ margin: 0 }}>无障碍</div>
          <button
            className={colorblind ? 'primary' : ''}
            style={{ padding: '8px 10px', textAlign: 'left' }}
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

        <button className="primary" style={{ marginTop: 12 }} onClick={() => setScreen('team')}>
          开始挑战（{selectedMode === 'novice' ? '新手模式' : selectedMode === 'normal' ? '普通无尽' : '铁人无尽'}）
        </button>
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
      </div>
    </div>
  );
}
