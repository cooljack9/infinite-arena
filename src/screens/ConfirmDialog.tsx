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
    <div className="overlay overlay--top" onClick={onCancel}>
      <div
        className={'sheet' + (danger ? ' sheet--danger' : ' sheet--info')}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 380 }}
      >
        <div className="sheet__title">
          {danger ? '⚠ ' : ''}{title}
        </div>
        <div className="sheet__body">{body}</div>
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
