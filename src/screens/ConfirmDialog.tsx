// v2.7 通用二次确认弹窗。
//
// 为什么不用 window.confirm：原生弹窗会打断 Canvas 渲染循环、在移动端浏览器
// 样式完全失控，而且没法把「返还多少金币、身上还挂着几件装备」这些决策依据
// 摆给玩家看。二次确认的价值不在于多点一次，而在于把后果显式化——
// 只是拦一下却不告诉玩家拦的是什么，那只是多一次点击成本。
//
// z-index 取 90：必须压过 HeroPanel(60)，因为出售入口本身就开在角色面板里。
import { ReactNode } from 'react';

interface Props {
  title: string;
  /** 后果说明：会被渲染成正文，支持传节点以便高亮关键数字 */
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作（出售 / 销毁）用红色确认键，普通操作用主色 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, body, confirmLabel = '确认', cancelLabel = '取消', danger = true, onConfirm, onCancel,
}: Props) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(4,7,14,0.78)',
        backdropFilter: 'blur(3px)', zIndex: 90,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 380, width: '100%',
          border: `1px solid ${danger ? '#ff6b6b' : '#4aa3ff'}`,
          borderRadius: 12, padding: 16,
          background: 'linear-gradient(180deg, rgba(24,18,22,0.98), rgba(12,14,20,0.98))',
          boxShadow: `0 18px 48px rgba(0,0,0,0.65), 0 0 24px ${danger ? '#ff6b6b33' : '#4aa3ff33'}`,
          color: '#e8e8e8',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 15, color: danger ? '#ff8a8a' : '#8ec5ff' }}>
          {danger ? '⚠ ' : ''}{title}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7, color: '#cfd6e4' }}>{body}</div>
        <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button style={{ padding: '4px 14px' }} onClick={onCancel}>{cancelLabel}</button>
          <button
            className="primary"
            style={{ padding: '4px 14px', ...(danger ? { color: '#ff8a8a' } : {}) }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
