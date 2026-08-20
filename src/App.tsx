import { lazy, Suspense, useEffect } from 'react';
import { useGame } from './game/state/store';
import { audio } from './audio';
import MainMenu from './screens/MainMenu';
import { ToastHost } from './components/Toast';

// vX 架构优化：重型屏幕（含 Canvas / core 引擎引用）按需懒加载，降低首屏 JS 体积、提升 TTI。
// MainMenu 作为首屏入口保持急切加载；共享件 Toast 亦急切加载。
const TeamBuilder = lazy(() => import('./screens/TeamBuilder'));
const PreBattle = lazy(() => import('./screens/PreBattle'));
const BattleScreen = lazy(() => import('./screens/BattleScreen'));
const ResultScreen = lazy(() => import('./screens/ResultScreen'));
const IntermissionHub = lazy(() => import('./screens/intermission/IntermissionHub'));
const BattleEval = lazy(() => import('./screens/BattleEval'));

// 懒加载骨架：复用 .panel 视觉语言，避免空白闪屏
function ScreenFallback() {
  return (
    <div className="app">
      <div className="panel accent col center" style={{ minHeight: 160, justifyContent: 'center' }}>
        <div className="title title-hero" style={{ fontSize: 18 }}>加载中…</div>
        <div className="subtitle">正在准备战场</div>
      </div>
    </div>
  );
}

export default function App() {
  const screen = useGame((s) => s.screen);
  const fxBusy = useGame((s) => s.fxBusy);
  const departScene = useGame((s) => s.departScene);
  // vX 省电档：账号级 renderQuality 落到 <html data-quality>，供 CSS 关闭 aurora 流动动画等重合成层
  const renderQuality = useGame((s) => s.renderQuality);
  useEffect(() => {
    document.documentElement.setAttribute('data-quality', renderQuality);
  }, [renderQuality]);

  // v3.4 BGM：按屏幕驱动——战斗/布阵播战歌，休整（商店）播休息曲，其余停
  useEffect(() => {
    if (screen === 'battle' || screen === 'pre') audio.playMusic('battle');
    else if (screen === 'inter') audio.playMusic('shop');
    else audio.stopMusic();
  }, [screen]);

  return (
    <>
      {screen === 'menu' && <MainMenu />}
      {screen !== 'menu' && (
        <Suspense fallback={<ScreenFallback />}>
          {screen === 'team' && <TeamBuilder />}
          {screen === 'pre' && <PreBattle />}
          {screen === 'battle' && <BattleScreen />}
          {screen === 'inter' && <IntermissionHub />}
          {screen === 'result' && <ResultScreen />}
          {screen === 'eval' && <BattleEval />}
        </Suspense>
      )}

      {/* v3.3c 出征台词：编队完成 → 布阵期间的全屏台词（先发 startRun，台词掩盖传参延迟） */}
      {departScene && (
        <div className="depart">
          {departScene.phase === 1 ? (
            <div className="depart__line depart__line--gold">
              {departScene.heroes.map((h) => `${h.name}（${h.cls}）`).join('，')}，踏上了未知的道路
            </div>
          ) : (
            <div className="depart__line depart__line--soft">
              等待他们的究竟是荣耀，财富，还是无尽的黑暗？
            </div>
          )}
        </div>
      )}

      {/* v3.2b 全局动画锁：动画播放期间遮罩拦截一切交互，中央悬浮展示提示文字（防连点/防中途误操作）。
          v1.7 两段波：按 phase 显示 wave1 / wave2。 */}
      {fxBusy && (
        <div className="fx-busy">
          <div className="fx-busy__tag">
            {typeof fxBusy === 'string' ? fxBusy : (fxBusy.phase === 1 ? fxBusy.wave1 : fxBusy.wave2)}
          </div>
        </div>
      )}

      {/* v1.3 全局轻提示宿主 */}
      <ToastHost />
    </>
  );
}
