// v2.10 高阶机制「?」说明云（UX-5）——全模式可用，复用 TutorialOverlay 的云朵视觉。
//
// 与 TutorialOverlay 的区别：这是**由「?」按钮显式触发**的说明弹窗（不绑定层/屏幕/模式），
// 点遮罩 / ✕ / Esc / 「知道了」均可关闭。定位逻辑与 TutorialOverlay 一致：
//  · 渲染后测量真实高度，重算顶边使「知道了」按钮始终落在视口内（修复「蘑菇云」点不到）。
//  · 锚点可能尚未挂载时用 rAF 轮询最多 30 帧兜底居中。
import { useEffect, useLayoutEffect, useRef, useState, CSSProperties } from 'react';
import { getFitZoom } from '../render/fitScreen';

type ArrowDir = 'up' | 'down';
interface BubblePos { top: number; left: number; arrow: ArrowDir; tailLeft: number; }

const BUBBLE_W = 288;
const BUBBLE_H = 120;
const SAFE_TOP = 8;
const SAFE_BOTTOM = 40;

// 定位一律在「未缩放坐标系」中进行：#root 带 CSS zoom，写入 style.top/left 的值会被
// 再乘一次缩放系数。故把视口尺寸与锚点 rect（getBoundingClientRect 返回的是 scaled 值）
// 统统除以当前 zoom，算出的 top/left 才能落到正确的视口位置（体检报告 UI-5）。
function computePos(anchorId: string, setPos: (p: BubblePos) => void) {
  const z = getFitZoom() || 1;
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  const fallback = () => setPos({ top: vh / 2 - BUBBLE_H / 2, left: vw / 2 - BUBBLE_W / 2, arrow: 'up', tailLeft: BUBBLE_W / 2 });
  const el = typeof document !== 'undefined' ? document.getElementById(anchorId) : null;
  if (!el) { fallback(); return; }
  const r0 = el.getBoundingClientRect();
  const r = {
    left: r0.left / z, right: r0.right / z, top: r0.top / z, bottom: r0.bottom / z,
    width: r0.width / z, height: r0.height / z,
  };
  const anchorCx = r.left + r.width / 2;
  const minTop = SAFE_TOP;
  const maxTop = Math.max(minTop, vh - SAFE_BOTTOM - BUBBLE_H);
  const prefArrow: ArrowDir = r.top < vh / 2 ? 'up' : 'down';
  let arrow = prefArrow;
  let top = arrow === 'up' ? r.bottom + 14 : r.top - 14 - BUBBLE_H;
  if (top < minTop) {
    const above = r.top - 14 - BUBBLE_H;
    if (above >= minTop) { top = above; arrow = 'down'; } else top = minTop;
  } else if (top > maxTop) {
    const below = r.bottom + 14;
    if (below <= maxTop) { top = below; arrow = 'up'; } else top = maxTop;
  }
  top = Math.max(minTop, Math.min(maxTop, top));
  const left = Math.max(12, Math.min(vw - BUBBLE_W - 12, anchorCx - BUBBLE_W / 2));
  const tailLeft = Math.max(22, Math.min(BUBBLE_W - 22, anchorCx - left));
  setPos({ top, left, arrow, tailLeft });
}

export default function MechanismHelp({
  anchorId,
  title,
  text,
  onClose,
}: {
  anchorId: string;
  title: string;
  text: string;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<BubblePos | null>(null);
  const [topFixed, setTopFixed] = useState<number | null>(null);
  const cloudRef = useRef<HTMLDivElement>(null);

  // 锚点可能随布局/子页变化 → rAF 轮询最多 30 帧后兜底居中
  useLayoutEffect(() => {
    let raf = 0;
    let tries = 0;
    const tick = () => {
      if (document.getElementById(anchorId) || tries >= 30) { computePos(anchorId, setPos); return; }
      tries += 1;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [anchorId]);

  // 测量真实高度，重算顶边使按钮不被挤出屏
  useLayoutEffect(() => {
    if (!pos || !cloudRef.current) { setTopFixed(null); return; }
    const realH = cloudRef.current.offsetHeight; // offsetHeight 是未缩放布局值，与下面 vh 同坐标系
    const vh = window.innerHeight / (getFitZoom() || 1);
    if (realH > 0) {
      const maxTop = vh - SAFE_BOTTOM - realH;
      let top = pos.top;
      if (top > maxTop) top = Math.max(SAFE_TOP, maxTop);
      if (top < SAFE_TOP) top = SAFE_TOP;
      setTopFixed(top);
    } else setTopFixed(pos.top);
  }, [pos]);

  useEffect(() => {
    const onResize = () => computePos(anchorId, setPos);
    window.addEventListener('resize', onResize);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };
  }, [anchorId, onClose]);

  if (!pos) return null;

  const tailStyle: CSSProperties =
    pos.arrow === 'up'
      ? { top: -10, left: pos.tailLeft - 11, borderLeft: '11px solid transparent', borderRight: '11px solid transparent', borderBottom: '12px solid #f4f7fd' }
      : { bottom: -10, left: pos.tailLeft - 11, borderLeft: '11px solid transparent', borderRight: '11px solid transparent', borderTop: '12px solid #f4f7fd' };

  return (
    // 半透明遮罩：点遮罩任意处关闭（pointer-events:auto）
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 420, pointerEvents: 'auto', background: 'rgba(0,0,0,0.18)' }}
      onClick={onClose}
    >
      <div
        ref={cloudRef}
        className="tut-cloud"
        style={{ top: topFixed ?? pos.top, left: pos.left, width: BUBBLE_W }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tut-tail" style={tailStyle} />
        <button className="tut-close" aria-label="关闭说明" onClick={onClose}>✕</button>
        <div className="tut-title">💡 {title}</div>
        <div className="tut-text">{text}</div>
        <div className="tut-foot">
          <span className="tut-count">说明</span>
          <button className="tut-next" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}
