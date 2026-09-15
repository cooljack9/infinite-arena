// v2.10 新手模式弹窗教学浮层（v2.2 云朵型对话框重写）
//
// 一个云朵型对话框，箭头指向要介绍的功能元素。仅在新手模式（TUTORIAL_MODE）下、
// 当前层 + 当前屏幕存在教学组时显示，每层 2 个教学点，分步点「下一步」推进。
//
// v2.10 修复「蘑菇云」按钮点不到（UX-4/UX-8 关联）：
//  · 旧版定位用写死高度 BUBBLE_H=132 求顶边，长文案教学点（tut-guide / tut-forge-transfer）
//    实际高度远超 132，把「知道了」按钮挤出屏底。现改为**渲染后测量真实高度**，
//    重算顶边使「关闭 / 下一步」按钮始终落在视口内（SAFE_TOP / SAFE_BOTTOM 安全余量）。
//  · 气泡加 max-height + overflow-y:auto（见 index.css .tut-cloud），极端长文也能完整滚动且按钮常驻。
//  · 新增「✕ 关闭」（右上角 + 底部）与「下一步 / 知道了」双按钮，均 pointer-events:auto、触控可达。
//  · 新增「不再显示教学」勾选（UX-8）：写 localStorage，熟练后全局不再打扰；MainMenu 可复位。
//
// 设计约束（沿用）：
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
const BUBBLE_H = 132; // 初始估计高度（定位初值）；渲染后以真实高度修正，见下方 useLayoutEffect
// 安全余量：顶部 8px + 底部 64px（含移动端地址栏 / 底部手势区 / 按钮高度），保证按钮点得到
const SAFE_TOP = 8;
const SAFE_BOTTOM = 64;
const SKIP_KEY = 'arena_tutorial_disabled';

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
  const minTop = SAFE_TOP;
  const maxTop = Math.max(minTop, vh - SAFE_BOTTOM - BUBBLE_H);
  // 默认：锚点在上半屏 → 云朵放下方(箭头朝上)；否则放上方(箭头朝下)。
  const prefArrow: ArrowDir = step.arrow ?? (r.top < vh / 2 ? 'up' : 'down');
  let arrow = prefArrow;
  let top = arrow === 'up' ? r.bottom + 14 : r.top - 14 - BUBBLE_H;
  // 首选方向放不下（会顶到屏幕边缘）就翻到另一侧，避免气泡被压到最底边、关闭键点不到。
  if (top < minTop) {
    const above = r.top - 14 - BUBBLE_H;
    if (above >= minTop) { top = above; arrow = 'down'; }
    else top = minTop;
  } else if (top > maxTop) {
    const below = r.bottom + 14;
    if (below <= maxTop) { top = below; arrow = 'up'; }
    else top = maxTop;
  }
  top = Math.max(minTop, Math.min(maxTop, top));
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
  // v2.10：渲染后按真实高度修正的顶边（保证按钮不被挤出屏）
  const [topFixed, setTopFixed] = useState<number | null>(null);
  const cloudRef = useRef<HTMLDivElement>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const key = run ? `${run.layer}:${screen}` : '';
  const group = run && run.mode === 'novice'
    ? TUTORIAL.find((g) => g.layer === run.layer && g.screen === screen)
    : undefined;
  const cur = group?.steps[step];

  // UX-8：全局跳过教学开关（localStorage）
  const [skipAll, setSkipAll] = useState<boolean>(() => {
    try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; }
  });

  // 切换层 / 屏幕 → 重置进度
  useEffect(() => { setStep(0); setDone(false); setTopFixed(null); }, [key]);

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

  // v2.10：测量真实高度，重算顶边使「关闭 / 下一步」按钮始终落在视口内
  useLayoutEffect(() => {
    if (!pos || !cloudRef.current) { setTopFixed(null); return; }
    const realH = cloudRef.current.offsetHeight;
    const vh = window.innerHeight;
    if (realH > 0) {
      const maxTop = vh - SAFE_BOTTOM - realH;
      let top = pos.top;
      if (top > maxTop) top = Math.max(SAFE_TOP, maxTop);
      if (top < SAFE_TOP) top = SAFE_TOP;
      setTopFixed(top);
    } else {
      setTopFixed(pos.top);
    }
  }, [pos, step, key]);

  // 视口变化时重新定位 + 重新修正顶边
  useEffect(() => {
    if (!cur) return;
    const onResize = () => { computePos(cur, setPos); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.anchorId, step, key]);

  if (!group || !cur || done || seen.has(key) || !pos || skipAll) return null;

  const isLast = step >= group.steps.length - 1;
  const advance = () => {
    if (isLast) { seen.add(key); setDone(true); }
    else setStep(step + 1);
  };
  // 「关闭」= 结束本组教学（标记 seen，本次不再弹）；不推进到下一步
  const close = () => { seen.add(key); setDone(true); };
  const toggleSkipAll = (v: boolean) => {
    setSkipAll(v);
    try { if (v) localStorage.setItem(SKIP_KEY, '1'); else localStorage.removeItem(SKIP_KEY); } catch { /* ignore */ }
    if (v) { seen.add(key); setDone(true); }
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
        style={{ top: topFixed ?? pos.top, left: pos.left, width: BUBBLE_W }}
      >
        <div className="tut-tail" style={tailStyle} />
        {/* 右上角关闭角标 */}
        <button
          className="tut-close"
          aria-label="关闭教学"
          onClick={close}
        >
          ✕
        </button>
        <div className="tut-title">💡 {cur.title}</div>
        <div className="tut-text">{cur.text}</div>
        <div className="tut-foot">
          <button className="tut-skip" onClick={close} aria-label="关闭本组教学">
            关闭
          </button>
          <span className="tut-count">{step + 1} / {group.steps.length}</span>
          <button className="tut-next" onClick={advance}>
            {isLast ? '开始挑战' : '下一步'}
          </button>
        </div>
        <label className="tut-dont">
          <input
            type="checkbox"
            checked={skipAll}
            onChange={(e) => toggleSkipAll(e.target.checked)}
          />
          不再显示教学
        </label>
      </div>
    </div>
  );
}
