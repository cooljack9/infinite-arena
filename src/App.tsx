import { useEffect } from 'react';
import { useGame } from './game/state/store';
import { audio } from './audio';
import MainMenu from './screens/MainMenu';
import TeamBuilder from './screens/TeamBuilder';
import PreBattle from './screens/PreBattle';
import BattleScreen from './screens/BattleScreen';
import ResultScreen from './screens/ResultScreen';
import IntermissionHub from './screens/intermission/IntermissionHub';
import BattleEval from './screens/BattleEval';

export default function App() {
  const screen = useGame((s) => s.screen);
  const fxBusy = useGame((s) => s.fxBusy);
  const departScene = useGame((s) => s.departScene);

  // v3.4 BGM：按屏幕驱动——战斗/布阵播战歌，休整（商店）播休息曲，其余停
  useEffect(() => {
    if (screen === 'battle' || screen === 'pre') audio.playMusic('battle');
    else if (screen === 'inter') audio.playMusic('shop');
    else audio.stopMusic();
  }, [screen]);

  return (
    <>
      {screen === 'menu' && <MainMenu />}
      {screen === 'team' && <TeamBuilder />}
      {screen === 'pre' && <PreBattle />}
      {screen === 'battle' && <BattleScreen />}
      {screen === 'inter' && <IntermissionHub />}
      {screen === 'result' && <ResultScreen />}
      {screen === 'eval' && <BattleEval />}

      {/* v3.3c 出征台词：编队完成 → 布阵期间的全屏台词（先发 startRun，台词掩盖传参延迟） */}
      {departScene && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(4,6,12,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 36px',
          }}
        >
          {departScene.phase === 1 ? (
            <div style={{ fontSize: 26, fontWeight: 700, color: '#ffd76a', lineHeight: 1.8, textAlign: 'center', animation: 'countdown-pop 0.8s ease-out' }}>
              {departScene.heroes.map((h) => `${h.name}（${h.cls}）`).join('，')}，踏上了未知的道路
            </div>
          ) : (
            <div style={{ fontSize: 22, fontWeight: 700, color: '#cfd6e4', textAlign: 'center', animation: 'countdown-pop 0.8s ease-out' }}>
              等待他们的究竟是荣耀，财富，还是无尽的黑暗？
            </div>
          )}
        </div>
      )}

      {/* v3.2b 全局动画锁：动画播放期间遮罩拦截一切交互，中央悬浮展示提示文字（防连点/防中途误操作） */}
      {fxBusy && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, cursor: 'default', background: 'rgba(4,6,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            className="tag"
            style={{
              padding: '12px 22px', fontSize: 16, color: '#ffd76a', borderColor: '#ffd76a88',
              background: 'rgba(10,12,20,0.9)', animation: 'hero-glow 0.9s ease-in-out infinite',
            }}
          >
            {fxBusy}
          </div>
        </div>
      )}
    </>
  );
}
