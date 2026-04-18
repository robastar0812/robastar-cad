// Drop zones for file 1 (single / diff) and file 2 (diff only). File input
// elements keep their original IDs so legacy setupZone() hooks them up.

export default function DropRow() {
  return (
    <div className="drop-row mode-single" id="dropRow">
      <div className="drop-zone dz1" id="zone1">
        <input type="file" id="file1" />
        <div className="dz-num">1</div>
        <div className="dz-body">
          <div className="dz-label" id="dzLabel1">図面ファイル</div>
          <div className="dz-hint" id="hint1">
            ここにドロップ
            <small>DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / 画像  ※SLDPRT→STEPに変換してください</small>
          </div>
          <div className="dz-name" id="name1"></div>
          <div className="dz-meta" id="meta1"></div>
        </div>
        <span className="dz-badge" id="badge1"></span>
        <button
          className="clear-btn"
          id="clr1"
          onClick={(e) => {
            e.stopPropagation()
            window.clearFile?.(1, e)
          }}
        >
          ✕ CLR
        </button>
      </div>
      <div className="dz-divider" id="dzDiv" style={{ display: 'none' }}>↔</div>
      <div className="drop-zone dz2 disabled" id="zone2" style={{ display: 'none' }}>
        <input type="file" id="file2" disabled />
        <div className="dz-num">2</div>
        <div className="dz-body">
          <div className="dz-label">比較ファイル (FILE 2)</div>
          <div className="dz-hint" id="hint2">
            FILE 1 を先に読み込んでください
            <small>DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / 画像  ※SLDPRT→STEPに変換してください</small>
          </div>
          <div className="dz-name" id="name2"></div>
          <div className="dz-meta" id="meta2"></div>
        </div>
        <span className="dz-badge" id="badge2"></span>
        <button
          className="clear-btn"
          id="clr2"
          onClick={(e) => {
            e.stopPropagation()
            window.clearFile?.(2, e)
          }}
        >
          ✕ CLR
        </button>
      </div>
    </div>
  )
}
