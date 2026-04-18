// Tab bar: visual / layers / struct / text / 3d. Handlers delegate to
// window.switchTab (installed by viewer.js init() IIFE, which wraps the
// original to also toggle the layers-preview overlay).

export default function TabBar() {
  return (
    <div className="tab-bar">
      <button className="tab-btn active" data-tab="visual" onClick={() => window.switchTab?.('visual')}>
        ビジュアル
      </button>
      <button className="tab-btn" data-tab="layers" onClick={() => window.switchTab?.('layers')} id="tabLayers">
        レイヤー展開
      </button>
      <button className="tab-btn" data-tab="struct" onClick={() => window.switchTab?.('struct')}>
        内部構造
      </button>
      <button className="tab-btn" data-tab="text" onClick={() => window.switchTab?.('text')}>
        テキスト
      </button>
      <button className="tab-btn" data-tab="3d" onClick={() => window.switchTab?.('3d')} id="tab3d">
        3Dビュー
      </button>
      <div className="tab-bar-right">
        <div className="tol-wrap" id="tolWrap" style={{ display: 'none' }}>
          <span>誤差</span>
          <input
            className="tol-inp"
            id="tolerance"
            type="number"
            defaultValue="0.01"
            step="0.001"
            min="0"
            onChange={() => window.rerun?.()}
          />
        </div>
        <div className="legend" id="diffLegend" style={{ display: 'none' }}>
          <div className="leg" id="leg-same" onClick={() => window.toggleLeg?.('same')}>
            <svg className="leg-sq" viewBox="0 0 8 8"><rect width="8" height="8" fill="#3a6480" /></svg>
            <span style={{ color: 'var(--dim)' }}>共通</span>
          </div>
          <div className="leg" id="leg-add" onClick={() => window.toggleLeg?.('add')}>
            <svg className="leg-sq" viewBox="0 0 8 8"><rect width="8" height="8" fill="#00e87a" /></svg>
            <span style={{ color: 'var(--add)' }}>追加</span>
          </div>
          <div className="leg" id="leg-del" onClick={() => window.toggleLeg?.('del')}>
            <svg className="leg-sq" viewBox="0 0 8 8"><rect width="8" height="8" fill="#ff3d5a" /></svg>
            <span style={{ color: 'var(--del)' }}>削除</span>
          </div>
        </div>
        <button className="ctrl-btn" onClick={() => window.fitView?.()}>FIT</button>
        <button className="ctrl-btn" onClick={() => window.zoom?.(1.3)}>＋</button>
        <button className="ctrl-btn" onClick={() => window.zoom?.(0.77)}>－</button>
        <span id="pageNavInline" style={{ display: 'none', gap: '4px', alignItems: 'center' }}>
          <button className="ctrl-btn" id="prevPage" onClick={() => window.changePage?.(-1)}>◀</button>
          <span id="pageLabel" style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--dim)' }}>1/1</span>
          <button className="ctrl-btn" id="nextPage" onClick={() => window.changePage?.(1)}>▶</button>
        </span>
      </div>
    </div>
  )
}
