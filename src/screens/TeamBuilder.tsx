import { useState } from 'react';
import { useGame } from '../game/state/store';
import { HEROES } from '@arena/core/content/heroes';
import { SUBCLASS_INFO } from '@arena/core/content/classes';
import { variateHero } from '@arena/core/content/variant';
import { HeroDef } from '@arena/core/types';

export default function TeamBuilder() {
  const startRun = useGame((s) => s.startRun);
  const selection = useGame((s) => s.teamSelection);
  const setTeamSelection = useGame((s) => s.setTeamSelection);
  const presets = useGame((s) => s.teamPresets);
  const savePreset = useGame((s) => s.savePreset);
  const applyPreset = useGame((s) => s.applyPreset);
  const deletePreset = useGame((s) => s.deletePreset);
  const selectedMode = useGame((s) => s.selectedMode);
  const departScene = useGame((s) => s.departScene);
  const setDepartScene = useGame((s) => s.setDepartScene);
  const [presetName, setPresetName] = useState('');

  const toggle = (id: string) => {
    if (selection.includes(id)) {
      // 取消选择（可低于 3 以便换人，但出战需恰好 3）
      setTeamSelection(selection.filter((x) => x !== id));
    } else if (selection.length < 3) {
      // 开局固定 3 人，不可多选
      setTeamSelection([...selection, id]);
    }
  };

  const team: HeroDef[] = selection.map((id) => HEROES.find((h) => h.id === id)!).filter(Boolean);

  // v3.3c 出征：先发 startRun（队伍传参后台进行），同时播两句台词（全局覆盖层，随屏保留）
  const depart = () => {
    if (selection.length !== 3 || departScene) return;
    const taken: string[] = [];
    const heroes = team.map((h, i) => {
      const v = variateHero(h, ((Math.random() * 1e9) | 0) ^ (i * 0x9e3779b1), taken);
      if (v.personalName) taken.push(v.personalName);
      return { name: v.personalName ?? h.name, cls: SUBCLASS_INFO[h.subclass].cn };
    });
    setDepartScene({ heroes, phase: 1 });
    startRun(team);
    // v3.4 定时器竞态防护：startRun 失败会清 departScene，此时不再重建/强清（防遮罩闪烁）
    setTimeout(() => {
      if (!useGame.getState().departScene) return;
      setDepartScene({ heroes, phase: 2 });
    }, 2000);
    setTimeout(() => {
      if (useGame.getState().departScene) setDepartScene(null);
    }, 4000);
  };

  return (
    <div className="app">
      <div className="panel col">
        <div className="title" style={{ fontSize: 18 }}>编队（{selection.length}/3）</div>
        <div className="row" style={{ gap: 6, marginTop: 2 }}>
          <span className="tag">{selectedMode === 'novice' ? '新手模式' : selectedMode === 'normal' ? '普通无尽' : '铁人无尽'}</span>
          <span className="subtitle" style={{ margin: 0 }}>开局固定三人小队（呼应「三人进入竞技场」），恰好选 3 名出战。建议覆盖 坦-输出-辅。</span>
        </div>
        <div className="grid-heroes">
          {HEROES.map((h) => {
            const info = SUBCLASS_INFO[h.subclass];
            const sel = selection.includes(h.id);
            return (
              <div
                key={h.id}
                className={`hero-card${sel ? ' sel' : ''}`}
                onClick={() => toggle(h.id)}
              >
                <div className="hero-name" style={{ color: info.color }}>{h.name}</div>
                <div className="hero-cat">{info.cn} · {h.trait}</div>
              </div>
            );
          })}
        </div>

        {/* v2.0 编队预设（需求文档 §5.1 P0） */}
        <div className="col" style={{ marginTop: 4, gap: 6 }}>
          <div className="row between">
            <span className="tag">编队预设（最多 3 套）</span>
            <span className="tag">{presets.length}/3</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {presets.length === 0 && <span className="tag">暂无预设，选好 3 人后保存。</span>}
            {presets.map((p, i) => (
              <div key={i} className="chip" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="preset-apply"
                  onClick={() => applyPreset(i)}
                  title="应用此预设"
                >{p.name}</button>
                <span
                  className="preset-del"
                  onClick={() => deletePreset(i)}
                  title="删除"
                  role="button"
                >✕</span>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="preset-input"
              type="text"
              placeholder="预设名称（可选）"
              value={presetName}
              maxLength={12}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button
              className="primary"
              disabled={selection.length !== 3 || presets.length >= 3}
              onClick={() => { savePreset(presetName); setPresetName(''); }}
            >保存预设</button>
          </div>
        </div>

        <div className="row between">
          <span className="tag">已选：{team.map((t) => t.name).join('、')}</span>
          <button className="primary" disabled={selection.length !== 3} onClick={depart}>
            {departScene ? '出征中…' : `出战（${selection.length}/3）`}
          </button>
        </div>
      </div>
    </div>
  );
}
