// v2.2 新手模式弹窗教学浮层
//
// 一个云朵型对话框，箭头指向要介绍的功能元素。仅在新手模式（TUTORIAL_MODE）下、
// 当前层 + 当前屏幕存在教学组时显示，每层 2 个教学点，分步点「知道了」推进。
//
// 设计约束：
//  · 浮层不拦截底层交互（容器 pointer-events:none，仅云朵本体可点），玩家可同时操作被指向的元素。
//  · 定位完全依赖 getBoundingClientRect，箭头方向按锚点相对视口位置自动判定，
//    锚点缺失时居中显示（不崩）。
//  · 同一「层:屏幕」在本次会话内只展示一次（module 级 seen 集合），避免重复打扰。
import { useEffect, useLayoutEffect, useRef, useState, CSSProperties } from 'react';
import { useGame } from '../game/state/store';
import { TUTORIAL, TutorialStep } from '@arena/core/content/tutorial';

type ArrowDir = 'up' | 'down';

interface BubblePos {
  top: number;
  left: number;
  arrow: ArrowDir;
  tailLeft: number; // 箭头尖在云朵内的水平偏移（px）
}

const BUBBLE_W = 288;
const BUBBLE_H = 132;

// 本次会话内已展示过的「层:屏幕」，避免重复弹出
const seen = new Set<string>();

function computePos(step: TutorialStep, setPos: (p: BubblePos) => void) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fallback = () => setPos({ top: vh / 2 - BUBBLE_H / 2, left: vw / 2 - BUBBLE_W / 2, arrow: 'up', tailLeft: BUBBLE_W / 2 });

  const el = typeof document !== 'undefined' ? document.getElementById(step.anchorId) : null;
  if (!el) { fallback(); return; }

  const r = el.getBoundingClientRect();
  const anchorCx = r.left + r.width / 2;
  // 锚点在上半屏 → 云朵放下方，箭头朝上；否则放上方，箭头朝下。
  const arrow: ArrowDir = step.arrow ?? (r.top < vh / 2 ? 'up' : 'down');
  let top = arrow === 'up' ? r.bottom + 14 : r.top - 14 - BUBBLE_H;
  top = Math.max(8, Math.min(vh - BUBBLE_H - 8, top));
  const left = Math.max(12, Math.min(vw - BUBBLE_W - 12, anchorCx - BUBBLE_W / 2));
  const tailLeft = Math.max(22, Math.min(BUBBLE_W - 22, anchorCx - left));
  setPos({ top, left, arrow, tailLeft });
}

export default function TutorialOverlay({ screen, onStep }: {
  screen: 'inter' | 'pre';
  /**
   * v2.9.4：休整屏拆成「穿戴 / 融合 / 商店」三套子页后，教学锚点只在对应子页激活时才在 DOM 里。
   * 每次教学点切换会把 anchorId 回调给宿主屏幕，由宿主自行切到该锚点所在的子页；
   * 定位逻辑会用 rAF 轮询等待锚点出现（见下方 useLayoutEffect），因此切页与定位无需同步。
   */
  onStep?: (anchorId: string) => void;
}) {
  const run = useGame((s) => s.run);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [pos, setPos] = useState<BubblePos | null>(null);
  const cloudRef = useRef<HTMLDivElement>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const key = run ? `${run.layer}:${screen}` : '';
  const group = run && run.mode === 'novice'
    ? TUTORIAL.find((g) => g.layer === run.layer && g.screen === screen)
    : undefined;
  const cur = group?.steps[step];

  // 切换层 / 屏幕 → 重置进度
  useEffect(() => { setStep(0); setDone(false); }, [key]);

  // 教学点变化 → 通知宿主屏幕切到该锚点所在子页（休整屏三子页用）
  useEffect(() => {
    if (cur && !seen.has(key) && !done) onStepRef.current?.(cur.anchorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.anchorId, step, key, done]);

  // 计算云朵位置（锚点可能随布局变化，依赖当前教学点与层）
  // 锚点可能因为「宿主刚被通知去切子页」而尚未挂载 → rAF 轮询最多 30 帧（约 0.5s）后再兜底居中。
  useLayoutEffect(() => {
    if (!cur) { setPos(null); return; }
    let raf = 0;
    let tries = 0;
    const tick = () => {
      if (document.getElementById(cur.anchorId) || tries >= 30) { computePos(cur, setPos); return; }
      tries += 1;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.anchorId, step, key]);

  // 视口变化时重新定位
  useEffect(() => {
    if (!cur) return;
    const onResize = () => computePos(cur, setPos);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.anchorId, step, key]);

  if (!group || !cur || done || seen.has(key) || !pos) return null;

  const isLast = step >= group.steps.length - 1;
  const advance = () => {
    if (isLast) { seen.add(key); setDone(true); }
    else setStep(step + 1);
  };

  const tailStyle: CSSProperties =
    pos.arrow === 'up'
      ? { top: -10, left: pos.tailLeft - 11, borderLeft: '11px solid transparent', borderRight: '11px solid transparent', borderBottom: '12px solid #f4f7fd' }
      : { bottom: -10, left: pos.tailLeft - 11, borderLeft: '11px solid transparent', borderRight: '11px solid transparent', borderTop: '12px solid #f4f7fd' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, pointerEvents: 'none' }}>
      <div
        ref={cloudRef}
        className="tut-cloud"
        style={{ top: pos.top, left: pos.left, width: BUBBLE_W }}
      >
        <div className="tut-tail" style={tailStyle} />
        <div className="tut-title">💡 {cur.title}</div>
        <div className="tut-text">{cur.text}</div>
        <div className="tut-foot">
          <span className="tut-count">{step + 1} / {group.steps.length}</span>
          <button className="tut-next" onClick={advance}>
            {isLast ? '开始挑战' : '知道了'}
          </button>
        </div>
      </div>
    </div>
  );
}
