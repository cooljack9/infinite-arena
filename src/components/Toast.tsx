// 全局轻提示（v1.3）：玻璃胶囊 + 底部滑入 + aria-live=polite（读屏友好）。
// 与游戏 store 完全解耦（独立订阅器），不污染任何确定性状态，后端契约零影响。
import { useEffect, useState } from 'react';

type ToastKind = 'info' | 'ok' | 'warn';
type ToastMsg = { id: number; text: string; kind: ToastKind };

let listeners: ((m: ToastMsg) => void)[] = [];
let counter = 0;

/** 在任意位置触发一条轻提示（不依赖 React 组件层级）。 */
export function toast(text: string, kind: ToastKind = 'info') {
  const m: ToastMsg = { id: ++counter, text, kind };
  for (const fn of listeners) fn(m);
}

function useToasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const fn = (m: ToastMsg) => {
      setItems((prev) => [...prev, m]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== m.id));
      }, 2600);
    };
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  }, []);
  return items;
}

export function ToastHost() {
  const items = useToasts();
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {items.map((m) => (
        <div key={m.id} className={'toast toast--' + m.kind} role="status">
          {m.text}
        </div>
      ))}
    </div>
  );
}
