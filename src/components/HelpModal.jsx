// Minimal help modal scaffolding. The original spa.html references #helpModal
// from showHelp/hideHelp/switchHelpTab but the markup was missing — this
// component fills in a basic skeleton so those handlers operate on real DOM.

const TABS = [
  { id: 'intro', label: '概要' },
  { id: 'basic', label: '基本操作' },
  { id: 'diff', label: '差分比較' },
  { id: 'formats', label: '対応形式' },
  { id: 'shortcuts', label: 'ショートカット' }
]

export default function HelpModal() {
  return (
    <div id="helpModal">
      <div id="helpInner">
        <div id="helpHeader">
          <h1>ROBA★STAR CAD — 操作説明</h1>
          <button id="helpClose" onClick={() => window.hideHelp?.()}>✕ 閉じる</button>
        </div>
        <div id="helpTabs">
          {TABS.map((tab, i) => (
            <button
              key={tab.id}
              className={`help-tab${i === 0 ? ' active' : ''}`}
              onClick={() => window.switchHelpTab?.(i)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div id="helpBody">
          <section className="help-section active">
            <h2 className="help-h2">ROBA★STAR CAD とは</h2>
            <p className="help-p">
              DXF / PDF / STL / OBJ / STEP / IGES / PLY / OFF / 画像に対応した図面解析・差分比較ビューアです。
              単体展開モードで1ファイルを詳細解析、差分比較モードで2ファイル間の違いを可視化します。
            </p>
            <div className="help-tip">TIP: 意味色モードでは、穴・タップ・座ぐりなどを自動分類して色分けします。</div>
          </section>
          <section className="help-section">
            <h2 className="help-h2">基本操作</h2>
            <table className="help-table">
              <tbody>
                <tr><td>ファイル読込</td><td>ドロップゾーンにドラッグ&ドロップ、またはクリックして選択</td></tr>
                <tr><td>ズーム</td><td>ホイール / ＋−ボタン</td></tr>
                <tr><td>パン</td><td>ドラッグ</td></tr>
                <tr><td>フィット</td><td>FITボタン</td></tr>
              </tbody>
            </table>
          </section>
          <section className="help-section">
            <h2 className="help-h2">差分比較</h2>
            <p className="help-p">右上のモード切替で「差分比較」を選択し、FILE1 / FILE2 を読み込むと差分が表示されます。</p>
            <p className="help-p">追加=緑 / 削除=赤 / 共通=青 で可視化されます。</p>
          </section>
          <section className="help-section">
            <h2 className="help-h2">対応形式</h2>
            <p className="help-p">DXF, PDF, STL, OBJ, STEP, IGES, PLY, OFF, JPEG/PNG</p>
            <div className="help-warn">SLDPRT は直接読み込めません。STEP 等に変換してください。</div>
          </section>
          <section className="help-section">
            <h2 className="help-h2">ショートカット</h2>
            <table className="help-table">
              <tbody>
                <tr><td><span className="help-key">Esc</span></td><td>ヘルプ / モーダルを閉じる</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  )
}
