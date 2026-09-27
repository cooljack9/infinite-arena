// 全局等比缩放：以设计基准宽 DESIGN_W 为 1:1，按视口宽算缩放系数整体缩放 #root，
// 使页面在大屏上铺满；窄屏不缩放，交回流式布局 + 媒体查询。
//
// ── 设计要点（修正版，对应 docs/工程体检报告-v2.6.0.md 的 UI-1/2/3/7/8）──
// 1) **只放大、不缩小**（MIN_S = 1）：旧实现把 390px 手机缩到 0.513，12px 正文实际只剩
//    6.2px，且叠加 @media(max-width:560px) 的二次压字号。现在窄屏 zoom=1，#root 保持
//    `width:100%; max-width:760px` 的流式布局，字号正常。
// 2) **用 CSS `zoom` 而非 `transform: scale`**：transform 会创建 fixed 定位包含块，
//    破坏 .overlay 全屏弹窗居中；zoom 不创建包含块，fixed 弹窗仍相对视口。
// 3) **把系数写进 `--fit-zoom` CSS 变量**：关键修正。zoom 会把 100vw/100dvh 这类视口
//    单位"先按视口解析、再乘 zoom"，导致 .battle-stage 在 1000px 视口下渲染成 1316px
//    而出屏。凡全屏层/视口单位，统一写 `calc(100vw / var(--fit-zoom))` 即可抵消。
// 4) **不支持 zoom 的浏览器（Firefox<126）**：用 CSS.supports 判定并整体跳过；此时
//    #root 是流式布局，等同旧行为（而非 760px 固定宽那种被 overflow-x:hidden 裁死的回退）。
// 5) **用 documentElement.clientWidth**：window.innerWidth 含纵向滚动条宽度，会让
//    #root 渲染宽度超出可用宽度约 15px、被裁掉且无法横向滚动补救。
const DESIGN_W = 760;
const MIN_S = 1; // 只放大，不缩小
const MAX_S = 2.2;

let current = 1;

/** 当前缩放系数（供 JS 侧换算：canvas 内部分辨率、浮层 px 定位等）。未安装时恒为 1。 */
export function getFitZoom(): number {
  return current;
}

export function installFitScreen(root: HTMLElement): () => void {
  const supported =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1.5');

  const setVar = (s: number) => {
    current = s;
    document.documentElement.style.setProperty('--fit-zoom', String(s));
  };

  const apply = () => {
    if (!supported) {
      // 不支持 zoom：不缩放，#root 走流式布局（等同旧行为）
      root.style.zoom = '';
      root.style.width = '';
      setVar(1);
      return;
    }
    const vw = document.documentElement.clientWidth || window.innerWidth || DESIGN_W;
    const s = Math.max(MIN_S, Math.min(MAX_S, vw / DESIGN_W));
    root.style.zoom = String(s);
    setVar(s);
  };

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
