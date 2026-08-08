// 休整屏 ·「商店」子页（需求 ①：商店拆为独立子页面 + 装备筛选）。
// 装备买 / 售，商店刷新，一次性药剂购买；装备买卖均走顶部筛选条（品质 / 含属性 / 评分）。
import { useState } from 'react';
import { useGame } from '../../game/state/store';
import { CONSUMABLE_CFG } from '@arena/core/content/consumables';
import { EqCard } from './EqCard';
import { useEquipFilter } from './FilterBar';

export default function ShopTab() {
  const gold = useGame((s) => s.gold);
  const shopStock = useGame((s) => s.shopStock);
  const consumables = useGame((s) => s.consumables);
  const inventory = useGame((s) => s.inventory);
  const discount = useGame((s) => s.discount)();
  const buyItem = useGame((s) => s.buyItem);
  const buyAllShop = useGame((s) => s.buyAllShop);
  const sellItem = useGame((s) => s.sellItem);
  const refreshShop = useGame((s) => s.refreshShop);

  const shopCount = shopStock.equipment.length + shopStock.consumables.length;
  const cheapest = Math.min(
    ...[...shopStock.equipment, ...shopStock.consumables].map((s) => Math.round(s.basePrice * (1 - discount))),
    Infinity,
  );

  const buyF = useEquipFilter(shopStock.equipment);
  const sellF = useEquipFilter(inventory);

  const buyPrice = (e: { basePrice: number }) => Math.round(e.basePrice * (1 - discount));
  const sellPrice = (e: { basePrice: number }) => Math.round(e.basePrice * 0.5 * (1 - discount * 0.5));

  const [tip, setTip] = useState('');
  // v3.2 商店刷新动画（3s 掩盖后端延迟）
  const [refreshing, setRefreshing] = useState(false);
  const setFxBusy = useGame((s) => s.setFxBusy);
  const showTip = (t: string) => { setTip(t); window.setTimeout(() => setTip(''), 2800); };
  const doBuyAll = () => {
    const n = buyAllShop();
    showTip(n > 0 ? `🛒 一键全买：成交 ${n} 件${shopCount === n ? '，库存已免费刷新' : ''}` : '金币不足，一件都买不下');
  };

  return (
    <div className="col" style={{ marginTop: 4 }}>
      {tip && <div className="tag" style={{ color: '#8ec5ff', borderColor: '#8ec5ff55' }}>{tip}</div>}

      {/* ── 购买 ── */}
      <div className="row between" style={{ marginTop: 0, alignItems: 'center' }}>
        <div className="subtitle" style={{ margin: 0, textAlign: 'left' }} id="tut-shop-buy">
          装备商店（买 / 售）
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="primary"
            style={{ padding: '2px 10px', fontSize: 12 }}
            disabled={shopCount === 0 || gold < cheapest}
            title={
              shopCount === 0 ? '库存已空'
                : gold < cheapest ? '金币不足，最便宜的一件都买不起'
                  : '按价格从低到高买下整批库存（折扣逐件重算）；全部买空后免费刷新一批新货'
            }
            onClick={doBuyAll}
          >
            🛒 一键全买（{shopCount}）
          </button>
          <button
            id="tut-shop-refresh"
            style={{ padding: '2px 10px', fontSize: 12 }}
            disabled={gold < 1 || refreshing}
            onClick={() => {
              if (refreshing) return;
              setRefreshing(true);
              setFxBusy('正在搬出装备，请稍等');       // 悬浮提示 + 锁全局交互（防连点刷新）
              refreshShop();                         // 立即发请求（云端后台 / 本地即时）
              setTimeout(() => { setRefreshing(false); setFxBusy(null); }, 3000); // 3s 动画
            }}
            title="花 1 金币重新随机整批库存"
          >
            {refreshing ? '🔄 刷新中…' : '🔄 刷新 (1💰)'}
          </button>
        </div>
      </div>

      {buyF.controls}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }} id="tut-shop-buy-grid">
        {buyF.filtered.length === 0 && shopStock.consumables.length === 0 && <span className="muted">库存已空</span>}
        {buyF.filtered.map((e) => (
          <EqCard
            key={e.id}
            e={e}
            actionLabel={`买 ${buyPrice(e)}`}
            disabled={gold < buyPrice(e)}
            onClick={() => buyItem(e.id)}
          />
        ))}
        {shopStock.consumables.map((c) => {
          const cfg = CONSUMABLE_CFG[c.kind];
          const price = Math.round(c.basePrice * (1 - discount));
          return (
            <div
              key={c.id}
              style={{
                border: `1px solid ${cfg.color}`, borderRadius: 8, padding: '6px 8px', minWidth: 128,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                color: '#e8e8e8', fontSize: 12,
              }}
            >
              <div style={{ color: cfg.color, fontWeight: 700 }}>{cfg.icon} {cfg.name}</div>
              <div className="muted" style={{ marginTop: 2, fontSize: 11 }}>{cfg.desc}</div>
              <button
                className="primary"
                style={{ marginTop: 6, padding: '2px 8px', fontSize: 12 }}
                disabled={gold < price}
                onClick={() => buyItem(c.id)}
              >
                买 {price}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── 出售 ── */}
      <div className="subtitle" style={{ marginTop: 12, textAlign: 'left' }}>出售背包装备（半价回收，折扣影响更小）</div>
      {sellF.controls}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {sellF.filtered.length === 0 && <span className="muted">无可售装备</span>}
        {sellF.filtered.map((e) => (
          <EqCard
            key={e.id}
            e={e}
            actionLabel={`售 ${sellPrice(e)}`}
            onClick={() => sellItem(e.id)}
          />
        ))}
      </div>

      {/* ── 已持有药剂 ── */}
      <div className="subtitle" style={{ marginTop: 12, textAlign: 'left' }}>一次性药剂（已在原「休整」页使用）</div>
      {consumables.length === 0 ? (
        <div className="muted">尚未持有药剂（商店有 20% 概率刷出）</div>
      ) : (
        <div className="muted">本页不重复列出药剂使用入口；可在「休整总览」页对队员使用。</div>
      )}
    </div>
  );
}
