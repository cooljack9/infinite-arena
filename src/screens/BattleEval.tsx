// v2.9.6 战后评价屏：每一战结束后展示敌我双方全部角色的
// 造成伤害 / 承受伤害 / 治疗 / 移动距离（我方左、敌方右）。
// MVP（友方 造成伤害+治疗 最高者）胜方额外获得 +1 随机一级属性成长奖励。
// 「继续」按钮按胜负与封顶层决定去路：胜→休整 / 封顶通关；负→重试战前 / 失败结算。
//
// v3.4j 我方/敌方名单以 run.team + battleRemote.replay.enemies 为准（全员显示），
// 数值字段（造成/承受/治疗/移动）从云端 outcome.stats 按 heroUid/id 查表填入——
// stats 偶发漏单位时仍展示全员，缺失数值显示 0。
import { useGame } from '../game/state/store';
import { PrimaryAttrs } from '@arena/core/types';

const STAT_CN: Record<keyof PrimaryAttrs, string> = {
  con: '体质', str: '力量', agi: '敏捷', int: '智力',
};

type EvalRow = { id: string; side: 'ally' | 'enemy'; name: string; heroUid?: string; dmgDealt: number; dmgTaken: number; healDone: number; moveDist: number };

export default function BattleEval() {
  const run = useGame((s) => s.run)!;
  const evalState = useGame((s) => s.battleEval);
  const battleRemote = useGame((s) => s.battleRemote);
  const setScreen = useGame((s) => s.setScreen);
  const finishBattle = useGame((s) => s.finishBattle);

  if (!evalState) {
    // 理论上不会走到这里（只有 recordBattleEval 才会把 screen 切到 eval）
    return (
      <div className="app">
        <div className="panel col">
          <div className="title">战后评价</div>
          <button className="primary" onClick={() => setScreen('inter')}>返回休整</button>
        </div>
      </div>
    );
  }

  const { rows, winner, currentLayer, nextLayer, cap, mvpUid, mvpStat, mvpAdd } = evalState;

  // v3.4j 我方全员：run.team（数值查 stats——heroUid 匹配）
  const statByUid = new Map<string, typeof rows[number]>();
  const statById = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    if (r.heroUid) statByUid.set(r.heroUid, r);
    statById.set(r.id, r);
  }
  const allies: EvalRow[] = run.team.map((h) => {
    const s = statByUid.get(h.uid);
    return {
      id: h.uid, side: 'ally' as const, name: h.name, heroUid: h.uid,
      dmgDealt: s?.dmgDealt ?? 0, dmgTaken: s?.dmgTaken ?? 0,
      healDone: s?.healDone ?? 0, moveDist: s?.moveDist ?? 0,
    };
  }).sort((a, b) => (b.dmgDealt + b.healDone) - (a.dmgDealt + a.healDone));

  // v3.4j 敌方全员：replay.enemies 过滤建筑（数值查 stats——id 匹配）
  const enemyUnits = (battleRemote?.replay?.enemies ?? []).filter((u: { isBuilding?: boolean }) => !u.isBuilding);
  const enemies: EvalRow[] = enemyUnits.map((u: { id: string; name: string }) => {
    const s = statById.get(u.id);
    return {
      id: u.id, side: 'enemy' as const, name: u.name,
      dmgDealt: s?.dmgDealt ?? 0, dmgTaken: s?.dmgTaken ?? 0,
      healDone: s?.healDone ?? 0, moveDist: s?.moveDist ?? 0,
    };
  }).sort((a, b) => (b.dmgDealt + b.healDone) - (a.dmgDealt + a.healDone));

  // MVP 姓名：我方列表里查（保证能显示名字，即便 stats 缺该 uid）
  const mvpName = mvpUid ? allies.find((r) => r.heroUid === mvpUid)?.name : undefined;

  const cont = () => {
    if (winner === 'lose') {
      if ((run.failures ?? 0) >= 3) finishBattle(false, currentLayer, run.score);
      else setScreen('pre');
    } else if (nextLayer > cap) {
      finishBattle(true, currentLayer, run.score);
    } else {
      setScreen('inter');
    }
  };

  const renderRow = (r: EvalRow) => {
    const isMvp = r.side === 'ally' && r.heroUid && r.heroUid === mvpUid;
    return (
      <div key={r.id} className={'eval-row' + (isMvp ? ' mvp' : '')}>
        <span className="eval-name">
          {isMvp && <span className="eval-crown" title="本场 MVP">👑</span>}
          {r.name}
        </span>
        <span className="eval-num dmg">{Math.round(r.dmgDealt)}</span>
        <span className="eval-num taken">{Math.round(r.dmgTaken)}</span>
        <span className="eval-num heal">{Math.round(r.healDone)}</span>
        <span className="eval-num move">{r.moveDist.toFixed(1)}</span>
      </div>
    );
  };

  return (
    <div className="app">
      <div className="panel col eval-panel">
        <div className="row between" style={{ alignItems: 'center' }}>
          <div className="title" style={{ fontSize: 18 }}>
            第 {currentLayer} 层 · 战后评价
            <span className={'eval-result ' + winner}>
              {winner === 'win' ? ' 胜利' : ' 失败'}
            </span>
          </div>
          {winner === 'lose' && run.failures > 0 && (
            <span className="chip" style={{ color: '#9fd0ff' }}>
              剩余容错：{Math.max(0, 2 - run.failures)} 次
            </span>
          )}
        </div>

        {winner === 'win' && mvpUid && mvpAdd > 0 && mvpStat && (
          <div className="eval-mvp-banner">
            🏆 MVP：<b>{mvpName ?? '—'}</b> 获得额外成长奖励
            <b style={{ color: '#7ee08a' }}> +{mvpAdd} {STAT_CN[mvpStat]}</b>
          </div>
        )}

        <div className="subtitle">
          造成 / 承受 / 治疗 / 移动 —— 我方在左，敌方在右（含异常关卡的完整数据）
        </div>

        <div className="eval-cols">
          <div className="eval-col ally">
            <div className="eval-head">我方</div>
            <div className="eval-row eval-row-head">
              <span className="eval-name">角色</span>
              <span className="eval-num dmg">造成</span>
              <span className="eval-num taken">承受</span>
              <span className="eval-num heal">治疗</span>
              <span className="eval-num move">移动</span>
            </div>
            {allies.length ? allies.map(renderRow) : <div className="eval-empty">无</div>}
          </div>

          <div className="eval-col enemy">
            <div className="eval-head">敌方</div>
            <div className="eval-row eval-row-head">
              <span className="eval-name">角色</span>
              <span className="eval-num dmg">造成</span>
              <span className="eval-num taken">承受</span>
              <span className="eval-num heal">治疗</span>
              <span className="eval-num move">移动</span>
            </div>
            {enemies.length ? enemies.map(renderRow) : <div className="eval-empty">无</div>}
          </div>
        </div>

        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end', gap: 8 }}>
          <button className="primary" onClick={cont}>
            {winner === 'lose'
              ? (run.failures ?? 0) >= 3 ? '结束战斗' : '返回重试'
              : nextLayer > cap ? '通关结算' : '前往休整'}
          </button>
        </div>
      </div>
    </div>
  );
}
