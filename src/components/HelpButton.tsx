// v2.10 统一「?」帮助按钮（UX-9 三屏一致件）
// 放在任意机制/分区旁，点击触发 MechanismHelp 说明云。样式见 index.css .help-btn。
import { CSSProperties } from 'react';

export default function HelpButton({
  label,
  onClick,
  style,
}: {
  /** 无障碍标签 + hover 提示（必填，说明这是什么的帮助） */
  label: string;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className="help-btn"
      aria-label={`${label}（查看说明）`}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={style}
    >
      ?
    </button>
  );
}
