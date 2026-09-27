// 装备页（v2.4.7 整备拆分 ④）。
// 信息组：子页签（穿戴 EquipTab / 融合 ForgeTab，均原样复用）。
// 子页签受中枢控制：教学锚点（tut-forge* 等）需要从外部把页签切到位。
import { useGame } from '../../../game/state/store';
import EquipTab from '../EquipTab';
import ForgeTab from '../ForgeTab';
import type { GearSub } from './types';

export default function GearPage({ sub, onSubChange }: { sub: GearSub; onSubChange: (s: GearSub) => void }) {
  const inventory = useGame((s) => s.inventory);
  const subBtn = (key: GearSub, label: string, anchorId?: string) => (
    <button
      id={anchorId}
      key={key}
      role="tab"
      aria-selected={sub === key}
      className={'seg-btn' + (sub === key ? ' active' : '')}
      onClick={() => onSubChange(key)}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="seg" role="tablist" aria-label="装备子页面">
        {subBtn('equip', '🎽 穿戴', 'tut-equip')}
        {subBtn('forge', '🔥 融合', 'tut-forge')}
      </div>
      <div style={{ marginTop: 8 }}>
        {sub === 'equip' ? <EquipTab /> : <ForgeTab />}
      </div>
      {/* 背包空提示（帮助新玩家理解两页分工） */}
      {inventory.length === 0 && sub === 'equip' && (
        <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
          背包为空：装备从战利品箱与商店获得；多余低阶件可在「融合」页合成升阶。
        </div>
      )}
    </div>
  );
}
