// v1.8 自动爬塔配置：c1 战略三选一 + c2 预计胜率目标滑条（51~100）
import { useEffect, useRef, useState } from 'react';
import { CLIMB_STRATEGIES, CLIMB_STRATEGY_IDS, type ClimbStrategy } from '@arena/core/content/climb';
import { useGame } from '../../game/state/store';
import { predictWinRateAtAsync } from '../../game/autoclimb';

export default function ClimbConfig({
  onConfirm,
  onClose,
}: {
  onConfirm: (strategy: ClimbStrategy, winRateTarget: number) => void;
  onClose: () => void;
}) {
  const run = useGame((s) => s.run)!;
  const [strategy, setStrategy] = useState<ClimbStrategy | null>(null);
  const [winRate, setWinRate] = useState(51);

  // ── 预计胜率：分片估算 + 本弹窗生命周期内缓存（v1.8.1）──────
  // 旧版在 render 里同步调 predictWinRateAt（20 局蒙特卡洛，80~170ms）：
  // 点战略卡一下不说，**拖胜率滑条每动一格都会重算一遍**——那是纯粹的浪费。
  // 现在：只在 strategy 变化时算，切片跑不阻塞主线程，算完记进 ref 缓存。
  // 缓存作用域刻意限定在弹窗内——弹窗是模态的，期间队伍/装备不可能变，
  // 所以不存在"缓存过期还在用"的窗口；关掉重开即自然失效。
  const [predicted, setPredicted] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const cacheRef = useRef(new Map<ClimbStrategy, number>());

  useEffect(() => {
    if (!strategy) { setPredicted(null); setProgress(0); return; }
    const hit = cacheRef.current.get(strategy);
    if (hit !== undefined) { setPredicted(hit); setProgress(1); return; }
    let cancelled = false;
    setPredicted(null);
    setProgress(0);
    void predictWinRateAtAsync(run.layer + 1, strategy, {
      cancelled: () => cancelled,
      onProgress: (p) => { if (!cancelled) setProgress(p.ran / p.total); },
    }).then((v) => {
      if (cancelled || v === null) return;
      cacheRef.current.set(strategy, v);
      setPredicted(v);
    });
    return () => { cancelled = true; };
  }, [strategy, run.layer]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 980, background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="panel col"
        style={{ width: 420, maxWidth: '92vw', padding: 18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="title" style={{ fontSize: 17 }}>🔴 自动爬塔配置</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          连续挑战 ≤10 层：每层难度比正常 +10%~15%、收益不变；失败则前端播放到失败场并扣一次挑战机会。
        </div>

        {/* c1 战略三选一（选定后本次爬塔全程生效） */}
        <div className="subtitle" style={{ marginTop: 4 }}>c1 · 选择战略（全程生效）：</div>
        <div className="col" style={{ gap: 6 }}>
          {CLIMB_STRATEGY_IDS.map((id) => {
            const def = CLIMB_STRATEGIES[id];
            const active = strategy === id;
            return (
              <button
                key={id}
                className={active ? 'primary' : ''}
                style={{
                  textAlign: 'left', lineHeight: 1.4, cursor: 'pointer',
                  borderColor: active ? '#ffd76a' : 'rgba(255,255,255,0.14)',
                  background: active ? 'rgba(255,215,106,0.12)' : 'rgba(255,255,255,0.04)',
                }}
                onClick={() => setStrategy(id)}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>{def.name}</div>
                <div className="tag" style={{ color: '#cfd6e4' }}>{def.desc}</div>
              </button>
            );
          })}
        </div>

        {/* c2 预计胜率目标（51~100 滑条；跌破该值前继续爬） */}
        <div className="subtitle" style={{ marginTop: 10 }}>c2 · 预计胜率目标：</div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <input
            type="range"
            min={51}
            max={100}
            step={1}
            value={winRate}
            onChange={(e) => setWinRate(parseInt(e.target.value, 10))}
            style={{ flex: 1 }}
          />
          <span className="chip" style={{ color: '#ffd76a', minWidth: 52, textAlign: 'center' }}>{winRate}%</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          爬塔在「预计胜率跌破 {winRate}%」前继续；某层实际失败则当场停止。
          {predicted !== null ? (
            <span style={{ color: predicted >= 0.51 ? '#7ee08a' : '#ff8a8a', marginLeft: 6 }}>
              预计第 {run.layer + 1} 层胜率：{(predicted * 100).toFixed(0)}%
            </span>
          ) : strategy ? (
            <span style={{ color: '#9aa4b8', marginLeft: 6 }}>
              推演第 {run.layer + 1} 层胜率… {Math.round(progress * 100)}%
            </span>
          ) : null}
        </div>

        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end', gap: 8 }}>
          <button className="ghost" onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={!strategy}
            onClick={() => strategy && onConfirm(strategy, winRate)}
          >
            全军突击 🚀
          </button>
        </div>
      </div>
    </div>
  );
}
