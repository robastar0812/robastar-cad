// Main body: canvas for 2D rendering, 3D canvas overlay, text-diff view,
// clip-plane panel, loading overlay, plus the side panel with stats and
// inspector / struct / layer tabs. DOM IDs are preserved so the legacy
// viewer can manipulate them directly.

export default function BodyArea() {
  return (
    <div className="body-area">
      {/* Canvas area */}
      <div className="canvas-wrap" id="canvasWrap">
        <canvas id="mainCanvas"></canvas>
        <div className="canvas-empty" id="emptyMsg">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#1a3a5a" strokeWidth="1.5">
            <rect x="4" y="4" width="36" height="36" rx="2" />
            <line x1="4" y1="16" x2="40" y2="16" />
            <line x1="16" y1="16" x2="16" y2="40" />
            <circle cx="30" cy="30" r="5" strokeDasharray="3 2" />
            <line x1="16" y1="30" x2="22" y2="30" strokeDasharray="2 2" />
          </svg>
          <span>ファイルをドロップして解析開始</span>
          <span style={{ fontSize: '12px', color: 'rgba(66,100,128,.4)' }}>単体展開 / 差分比較に対応</span>
        </div>

        {/* Text diff view */}
        <div
          id="textDiffView"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'none',
            flexDirection: 'column',
            background: 'var(--bg)'
          }}
        >
          <div style={{
            display: 'flex',
            gap: '10px',
            padding: '6px 10px',
            borderBottom: '1px solid var(--border2)',
            fontFamily: 'var(--mono)',
            fontSize: '12px',
            flexShrink: 0
          }}>
            <span style={{ color: 'var(--add)' }} data-lang="leg-add">
              ■  <span className="leg-label">追加</span>
            </span>
            <span style={{ color: 'var(--del)' }} data-lang="leg-del">
              ■  <span className="leg-label">削除</span>
            </span>
            <span style={{ color: 'var(--dim)' }} data-lang="leg-same">
              ■  <span className="leg-label">共通</span>
            </span>
          </div>
          <div className="text-diff-area" id="textDiffContent" style={{ flex: 1 }}></div>
        </div>

        {/* 3D View */}
        <div id="view3d">
          <canvas id="canvas3d"></canvas>
          <div className="v3d-toolbar" id="v3dToolbar">
            <button className="v3d-btn active" id="v3dSolid" onClick={() => window.set3DMode?.('solid')}>ソリッド</button>
            <button className="v3d-btn" id="v3dWire" onClick={() => window.set3DMode?.('wire')}>ワイヤー</button>
            <button className="v3d-btn" id="v3dSem" onClick={() => window.set3DMode?.('semantic')}>意味色</button>
            <button className="v3d-btn" id="v3dEdge" onClick={() => window.set3DMode?.('edge')}>エッジ</button>
            <button className="v3d-btn" id="v3dClip" style={{ borderColor: 'rgba(0,255,208,.4)', color: '#00ffd0' }} onClick={() => window.toggleClipPanel?.()}>
              ✂ 断面
            </button>
            <button className="v3d-btn" style={{ borderColor: 'rgba(255,100,100,.4)', color: '#ff6464' }} onClick={() => window.reset3DCamera?.()}>
              リセット
            </button>
          </div>
          <div id="v3dClipPanel" style={{
            display: 'none',
            position: 'absolute',
            top: '40px',
            left: 0,
            width: '120px',
            height: '160px',
            background: 'rgba(3,6,14,.93)',
            border: '1px solid rgba(0,255,208,.25)',
            borderLeft: 'none',
            borderRadius: '0 8px 8px 0',
            zIndex: 10,
            flexDirection: 'row',
            alignItems: 'stretch',
            padding: '6px 4px',
            gap: '4px'
          }}>
            {[
              { axis: 'X', color: '#00ffd0', bg: 'rgba(0,255,208,.1)', border: 'rgba(0,255,208,.3)' },
              { axis: 'Y', color: '#00b4ff', bg: 'rgba(0,180,255,.1)', border: 'rgba(0,180,255,.3)' },
              { axis: 'Z', color: '#ff9900', bg: 'rgba(255,153,0,.1)', border: 'rgba(255,153,0,.3)' }
            ].map(({ axis, color, bg, border }) => (
              <div key={axis} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flex: 1 }}>
                <button
                  onClick={() => window.resetClipAxis?.(axis)}
                  style={{
                    fontSize: '9px',
                    padding: '1px 4px',
                    background: bg,
                    border: `1px solid ${border}`,
                    color,
                    cursor: 'pointer',
                    borderRadius: '3px',
                    flexShrink: 0
                  }}
                >↺</button>
                <input
                  type="range"
                  id={`clip${axis}`}
                  min="-100"
                  max="100"
                  defaultValue="100"
                  step="0.5"
                  style={{
                    writingMode: 'vertical-lr',
                    direction: 'rtl',
                    flex: 1,
                    width: '18px',
                    accentColor: color,
                    cursor: 'pointer',
                    minHeight: 0
                  }}
                  onInput={() => window.updateClipPlanes?.()}
                />
                <span style={{ font: `bold 9px var(--mono)`, color, flexShrink: 0 }}>{axis}</span>
              </div>
            ))}
          </div>
          <div className="v3d-info" id="v3dInfo">マウス: 回転 | Shift+ドラッグ: パン | ホイール: ズーム</div>
          <svg className="v3d-compass" id="v3dCompass" viewBox="0 0 60 60"></svg>
        </div>

        <div className="loading" id="loadingOverlay">
          <div className="scan"></div>
          <div className="loading-txt" id="loadingTxt">処理中...</div>
        </div>
      </div>

      {/* Side panel */}
      <div className="side" id="sidePanel">
        <div className="stats-grid" id="statsRow">
          <div className="stat"><div className="stat-n n-add" id="sAdd">—</div><div className="stat-l" id="sAddL" data-stat="added">追加</div></div>
          <div className="stat"><div className="stat-n n-del" id="sDel">—</div><div className="stat-l" id="sDelL" data-stat="removed">削除</div></div>
          <div className="stat"><div className="stat-n n-same" id="sSame">—</div><div className="stat-l" id="sSameL" data-stat="same">共通</div></div>
        </div>

        <div className="side-tab-bar" id="sideTabBar">
          <button className="side-tab active" data-st="list" onClick={() => window.setSideTab?.('list')}>一覧</button>
          <button className="side-tab" data-st="semleg" onClick={() => window.setSideTab?.('semleg')}>凡例</button>
          <button className="side-tab" data-st="inspect" onClick={() => window.setSideTab?.('inspect')}>詳細</button>
          <button className="side-tab" data-st="info1" onClick={() => window.setSideTab?.('info1')}>構造1</button>
          <button className="side-tab" data-st="info2" onClick={() => window.setSideTab?.('info2')} id="stInfo2">構造2</button>
        </div>

        <div id="st-list" className="side-content">
          <div className="ent-filter" id="entFilter">
            <button className="f-btn fa active" data-ef="add" onClick={() => window.setEF?.('add')}>追加</button>
            <button className="f-btn fd active" data-ef="del" onClick={() => window.setEF?.('del')}>削除</button>
            <button className="f-btn fs active" data-ef="same" onClick={() => window.setEF?.('same')}>共通</button>
          </div>
          <div id="entListBody"><div className="no-data">ファイルを読み込んでください</div></div>
        </div>

        <div id="st-semleg" className="side-content" style={{ display: 'none' }}>
          <div className="sem-legend" id="semLegendBody"><div className="no-data">DXFを読み込んでください</div></div>
        </div>

        <div id="st-inspect" className="side-content" style={{ display: 'none' }}>
          <div className="insp-empty" id="inspEmpty">エンティティをクリックで詳細表示</div>
          <div className="inspector" id="inspBody" style={{ display: 'none' }}></div>
        </div>

        <div id="st-info1" className="side-content" style={{ display: 'none' }}>
          <div id="info1Body"><div className="no-data">ファイルを読み込んでください</div></div>
        </div>

        <div id="st-info2" className="side-content" style={{ display: 'none' }}>
          <div id="info2Body"><div className="no-data">差分比較モードで使用</div></div>
        </div>
      </div>
    </div>
  )
}
