import { useGame } from '../game/state/store';
import { EPILOGUE } from '@arena/core/content/story';
import { NOVICE_CAP, ENDLESS_CAP } from '@arena/core/engine/scaling';
import { PrimaryAttrs } from '@arena/core/types';

export default function ResultScreen() {
  const last = useGame((s) => s.lastResult);
  const best = useGame((s) => s.bestLayer);
  const setScreen = useGame((s) => s.setScreen);
  const reset = useGame((s) => s.reset);
  const setSelectedMode = useGame((s) => s.setSelectedMode);
  const endlessUnlocked = useGame((s) => s.endlessUnlocked);
  const failures = useGame((s) => s.run?.failures ?? 0);
  const evalState = useGame((s) => s.battleEval);
  const run = useGame((s) => s.run);

  // v1.3 MVP 高亮卡：复用本局最后一场战斗的 MVP 快照（结算屏展示时 battleEval 仍有效）
  const STAT_CN: Record<keyof PrimaryAttrs, string> = { con: '体质', str: '力量', agi: '敏捷', int: '智力' };
  const mvpName = last?.win && evalState?.mvpUid
    ? (run?.team.find((h) => h.uid === evalState.mvpUid)?.name ?? 'MVP 勇者')
    : null;

  const mode = last?.mode ?? 'novice';
  const win = !!last?.win;
  const layer = last?.layer ?? 0;
  const outOfRetries = !win && failures >= 3;
  // 新手模式在封顶层（NOVICE_CAP=5）通关 = 本次真正「解锁」普通无尽 + 铁人无尽
  const noviceClear = win && mode === 'novice' && layer >= NOVICE_CAP;
  // 普通无尽 / 铁人无尽 在封顶层（ENDLESS_CAP=500）登顶
  const endlessTop = win && (mode === 'normal' || mode === 'ironman') && layer >= ENDLESS_CAP;
  const epilogue = noviceClear ? EPILOGUE : null;

  const again = () => { reset(); setScreen('team'); };
  // 新手通关后一键进入普通无尽（默认选普通，玩家可再切铁人）
  const toEndless = () => { setSelectedMode('normal'); reset(); setScreen('team'); };

  const modeLabel =
    mode === 'novice' ? '新手模式' : mode === 'normal' ? '普通无尽' : '铁人无尽';
  const title = noviceClear
    ? '新手模式 · 通关！'
    : endlessTop
      ? (mode === 'ironman' ? '铁人无尽 · 登顶 500 层！' : '普通无尽 · 登顶 500 层！')
      : win
        ? '挑战通关！'
        : '挑战终结';

  const share = () => {
    const text = `我在《无限勇者竞技场》${modeLabel}止步第 ${layer} 层，积分 ${last?.score}！历史最佳第 ${best} 层。`;
    try { navigator.clipboard?.writeText(text); alert('战绩已复制到剪贴板：\n' + text); }
    catch { alert(text); }
  };

  return (
    <div className="app">
      <div className="panel col center">
        <div className="title" style={{ fontSize: 18 }}>
          {title}
        </div>
        <div className="tag" style={{ marginTop: 4 }}>
          {modeLabel}{win ? ' · 胜利' : ' · 失败'}
        </div>
        <div className="big-num result-num">第 {layer} 层</div>

        {mvpName && (
          <div className="mvp-card">
            🏆 本场 MVP：<span className="mvp-card__name">{mvpName}</span>
            {evalState?.mvpAdd ? (
              <> 额外成长 <span className="mvp-card__add">+{evalState.mvpAdd} {evalState.mvpStat ? STAT_CN[evalState.mvpStat] : '属性'}</span></>
            ) : null}
          </div>
        )}
        <div className="subtitle">本局积分 {last?.score}</div>
        <div className="subtitle">历史最佳：第 {best} 层</div>
        {outOfRetries && (
          <div className="tag" style={{ marginTop: 6, color: '#ff9090', borderColor: '#ff909055' }}>
            已用完 2 次容错机会，本局终结
          </div>
        )}

        {noviceClear && (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              color: '#7ee08a',
              border: '1px solid #7ee08a55',
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            🎉 已解锁【普通无尽】与【铁人无尽】！现在可从主菜单选择无尽模式，挑战至 500 层登顶。铁人模式中阵亡的勇者将永久消失。
          </div>
        )}

        {epilogue && (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              lineHeight: 1.75,
              color: '#d9c7ff',
              borderTop: '1px solid rgba(255,255,255,0.12)',
              paddingTop: 10,
            }}
          >
            {epilogue}
          </div>
        )}

        <div className="row center" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
          {noviceClear && endlessUnlocked && (
            <button className="primary" onClick={toEndless}>🚀 进入普通无尽 →</button>
          )}
          <button className="primary" onClick={again}>🔄 再来一局</button>
          <button onClick={share}>📤 分享战绩</button>
          <button className="danger" onClick={() => setScreen('menu')}>🏠 回主菜单</button>
        </div>
      </div>
    </div>
  );
}
