export default function HelpModal() {
  return (
    <div id="helpModal">
      <div id="helpInner">
        <div id="helpHeader">
          <h1>ROBA★STAR CAD — 操作説明</h1>
          <button id="helpClose" onClick={() => window.hideHelp?.()}>✕ 閉じる</button>
        </div>
        <div id="helpTabs">
          {['概要','基本操作','検索・選択','差分比較','レイヤー','3Dビュー','ショートカット'].map((label, i) => (
            <button key={i} className={`help-tab${i===0?' active':''}`} onClick={() => window.switchHelpTab?.(i)}>{label}</button>
          ))}
        </div>
        <div id="helpBody">

          {/* 0: 概要 */}
          <div className="help-section active">
            <h3>ROBA★STAR CAD とは</h3>
            <p>DXF / PDF / STL / OBJ / STEP / IGES / PLY / OFF / 画像に対応した図面解析・差分比較ビューアです。単体展開モードで1ファイルを詳細解析、差分比較モードで2ファイル間の違いを可視化します。</p>
            <div className="help-tip">TIP: 意味色モードでは、穴・タップ・座ぐりなどを自動分類して色分けします。</div>
            <h3>画面構成</h3>
            <table className="help-table">
              <tbody>
                <tr><td>上部ヘッダー</td><td>ファイルドロップゾーン・モード切替・タブ切替</td></tr>
                <tr><td>中央キャンバス</td><td>図面表示エリア。ドラッグでパン、ホイールでズーム</td></tr>
                <tr><td>右パネル</td><td>統計情報・一覧・凡例・詳細・構造タブ</td></tr>
                <tr><td>右下ミニマップ</td><td>図面全体の縮小表示。クリックでジャンプ</td></tr>
              </tbody>
            </table>
          </div>

          {/* 1: 基本操作 */}
          <div className="help-section">
            <h3>ファイルの読み込み</h3>
            <table className="help-table">
              <tbody>
                <tr><td>ドラッグ＆ドロップ</td><td>ファイルをキャンバスまたはドロップゾーンに直接ドロップ</td></tr>
                <tr><td>クリックで選択</td><td>ドロップゾーンをクリックしてファイルダイアログを開く</td></tr>
                <tr><td>✕ボタン</td><td>読み込んだファイルをクリア</td></tr>
              </tbody>
            </table>
            <h3>キャンバス操作</h3>
            <table className="help-table">
              <tbody>
                <tr><td>ドラッグ</td><td>図面をパン(移動)</td></tr>
                <tr><td>ホイール</td><td>ズームイン/アウト</td></tr>
                <tr><td>FITボタン</td><td>図面全体を画面に合わせる</td></tr>
                <tr><td>エンティティクリック</td><td>部品・線を選択して詳細表示</td></tr>
                <tr><td>空白クリック / Esc</td><td>選択を解除</td></tr>
              </tbody>
            </table>
            <h3>表示モード(タブ)</h3>
            <table className="help-table">
              <tbody>
                <tr><td>ビジュアル</td><td>図面をCanvasに描画(メイン画面)</td></tr>
                <tr><td>レイヤー展開</td><td>レイヤー一覧・表示切替・分離スライダー</td></tr>
                <tr><td>内部構造</td><td>ファイルのメタデータ・エンティティ統計</td></tr>
                <tr><td>テキスト</td><td>PDF・テキストの差分表示</td></tr>
                <tr><td>3Dビュー</td><td>STL/OBJ/STEP/PLY/OFFの3D表示</td></tr>
              </tbody>
            </table>
            <h3>意味色モード</h3>
            <table className="help-table">
              <tbody>
                <tr><td style={{color:'#e8e8e8'}}>■ 外形線</td><td>部品の輪郭・外形</td></tr>
                <tr><td style={{color:'#4488ff'}}>■ 隠れ線</td><td>破線で表現される隠れた輪郭</td></tr>
                <tr><td style={{color:'#ff4444'}}>■ 中心線</td><td>一点鎖線の中心・軸線</td></tr>
                <tr><td style={{color:'#44dd66'}}>■ 寸法線</td><td>寸法・引出し注記</td></tr>
                <tr><td style={{color:'#ff44cc'}}>■ タップ穴</td><td>ねじ穴(M規格サイズ自動判定)</td></tr>
                <tr><td style={{color:'#ffcc00'}}>■ ビス穴</td><td>通し穴(クリアランス径自動判定)</td></tr>
                <tr><td style={{color:'#ff8833'}}>■ ザグリ穴</td><td>座ぐり穴(同心円検出)</td></tr>
                <tr><td style={{color:'#556677'}}>■ ハッチング</td><td>断面のハッチパターン</td></tr>
                <tr><td style={{color:'#88aaee'}}>■ テキスト</td><td>文字・寸法値・部品番号</td></tr>
              </tbody>
            </table>
          </div>

          {/* 2: 検索・選択 */}
          <div className="help-section">
            <h3>テキスト検索(一覧タブ)</h3>
            <p>右パネルの「一覧」タブ上部の検索ボックスに部品番号やテキストを入力すると、該当エンティティにジャンプします。</p>
            <table className="help-table">
              <tbody>
                <tr><td>入力</td><td>リアルタイムで検索・ジャンプ</td></tr>
                <tr><td>Enter / ▶ボタン</td><td>次のヒットへ移動</td></tr>
                <tr><td>◀ボタン</td><td>前のヒットへ移動</td></tr>
                <tr><td>✕ボタン</td><td>検索をクリア</td></tr>
              </tbody>
            </table>
            <h3>引き込み線の選択</h3>
            <p>引き込み線(リーダー線)をクリックすると、繋がった線が白くハイライトされ、先端に赤丸マーカーが表示されます。右パネルの「関連テキスト」に周辺の部品番号・説明が表示されます。</p>
            <div className="help-tip">TIP: 関連テキストをクリックするとクリップボードにコピーされます。</div>
            <h3>最近見た部品(詳細タブ)</h3>
            <p>クリックした部品の履歴が詳細タブ下部に最大5件表示されます。クリックで再ジャンプできます。</p>
            <h3>部品番号グループ(一覧タブ)</h3>
            <p>同じ番号のバルーンが複数ある場合、一覧タブ上部にグループ表示されます。クリックで最初の出現箇所にジャンプします。</p>
            <h3>部品番号とコメントの分離表示(詳細タブ)</h3>
            <p>テキストに <code>:</code>(コロン)が含まれる場合、左側を「部品番号」、右側を「コメント」として詳細タブに分けて表示します。</p>
            <table className="help-table">
              <tbody>
                <tr><td><code>A910C:COIL1,2</code></td><td>部品番号 = <b>A910C</b> / コメント = <b>COIL1,2</b></td></tr>
                <tr><td><code>B003C:OUTPUT</code></td><td>部品番号 = <b>B003C</b> / コメント = <b>OUTPUT</b></td></tr>
              </tbody>
            </table>
            <h3>選択寸法の自動合計(詳細タブ)</h3>
            <p>線・円・円弧・ポリラインを選択すると、詳細タブ上部に種類別の本数と長さ・面積、および「合計長さ」が自動表示されます。</p>
            <table className="help-table">
              <tbody>
                <tr><td>直線</td><td>選択された LINE の本数と長さ合計 (mm)</td></tr>
                <tr><td>ポリライン</td><td>各セグメント長を加算 (mm)。閉合時は最終辺も含める</td></tr>
                <tr><td>円弧</td><td>半径 × 角度から弧長を算出 (mm)</td></tr>
                <tr><td>円</td><td>面積合計 (mm²)</td></tr>
                <tr><td>合計長さ</td><td>直線・ポリライン・円弧の長さ総和 (mm)</td></tr>
              </tbody>
            </table>
            <div className="help-tip">TIP: 引き込み線をクリックすると繋がった線がチェーン選択され、合計値も自動更新されます。</div>
          </div>

          {/* 3: 差分比較 */}
          <div className="help-section">
            <h3>差分比較モード</h3>
            <p>ヘッダーの「差分比較」ボタンで切り替え。FILE1(基準)とFILE2(比較)の2ファイルを読み込むと差分を自動計算します。</p>
            <table className="help-table">
              <tbody>
                <tr><td style={{color:'#00e87a'}}>■ 緑(追加)</td><td>FILE2にのみ存在するエンティティ</td></tr>
                <tr><td style={{color:'#ff3d5a'}}>■ 赤(削除)</td><td>FILE1にのみ存在するエンティティ</td></tr>
                <tr><td style={{color:'rgba(58,100,140,0.65)'}}>■ 青(共通)</td><td>両ファイルに共通するエンティティ</td></tr>
              </tbody>
            </table>
            <h3>差分ジャンプ</h3>
            <p>一覧タブ下部の「◀ 前 / 次 ▶」ボタンで追加・削除箇所を順番に巡回できます。</p>
            <h3>誤差設定</h3>
            <p>ヘッダーの「誤差」スライダーで差分判定の許容誤差を調整できます。製造公差内の微小な違いを無視したい場合に使用します。</p>
          </div>

          {/* 4: レイヤー */}
          <div className="help-section">
            <h3>レイヤー展開タブ</h3>
            <table className="help-table">
              <tbody>
                <tr><td>全表示</td><td>全レイヤーを一括で表示ON</td></tr>
                <tr><td>全非表示</td><td>全レイヤーを一括で表示OFF</td></tr>
                <tr><td>引込線のみ</td><td>引き込み線・部品番号レイヤーのみ表示</td></tr>
                <tr><td>レイヤー行クリック</td><td>そのレイヤーの表示/非表示を切替</td></tr>
                <tr><td>分離スライダー</td><td>レイヤーを放射状に展開して構造を把握</td></tr>
              </tbody>
            </table>
            <h3>凡例タブ(意味色)</h3>
            <p>意味分類ごとの色凡例が表示されます。各行をクリックしてその分類の表示/非表示を切り替えられます。</p>
            <h3>図枠レイヤーの自動非表示</h3>
            <p>図枠・表題欄系のレイヤーは読み込み時に自動で非表示になります(図面本体に集中するため)。レイヤー展開タブで該当レイヤーをクリックすれば再表示できます。</p>
            <table className="help-table">
              <tbody>
                <tr><td>対象レイヤー名</td><td><code>ZUWAKU</code> / <code>FRAME</code> / <code>BORDER</code> / <code>TITLEBLOCK</code> / <code>TITLE</code> / <code>枠</code> / <code>図枠</code> / <code>表題欄</code> で始まるもの</td></tr>
                <tr><td>再表示</td><td>レイヤー展開タブ → 該当行クリック</td></tr>
                <tr><td>一括復活</td><td>「全表示」ボタンで全レイヤー表示</td></tr>
              </tbody>
            </table>
            <div className="help-tip">TIP: <code>TITLETEXT</code> など <code>TITLE</code> 以降に文字が続く場合は通常レイヤーと判定され表示されます。</div>
          </div>

          {/* 5: 3Dビュー */}
          <div className="help-section">
            <h3>対応形式</h3>
            <p>STL / OBJ / PLY / OFF / STEP(平面近似)</p>
            <h3>操作方法</h3>
            <table className="help-table">
              <tbody>
                <tr><td>ドラッグ</td><td>3Dモデルを回転</td></tr>
                <tr><td>Shift + ドラッグ</td><td>パン(平行移動)</td></tr>
                <tr><td>ホイール</td><td>ズーム</td></tr>
                <tr><td>リセットボタン</td><td>カメラ位置を初期化</td></tr>
              </tbody>
            </table>
            <h3>表示モード</h3>
            <table className="help-table">
              <tbody>
                <tr><td>ソリッド</td><td>PBRマテリアルで金属質感表示</td></tr>
                <tr><td>ワイヤー</td><td>ポリゴンのワイヤーフレーム表示</td></tr>
                <tr><td>意味色</td><td>面の向き(上面・側面等)で色分け</td></tr>
                <tr><td>エッジ</td><td>15度以上の稜線を強調表示</td></tr>
              </tbody>
            </table>
            <h3>✂ 断面機能</h3>
            <p>「断面」ボタンで断面パネルを開き、X/Y/Zスライダーで任意の位置で断面表示できます。↺ボタンで各軸をリセット。</p>
          </div>

          {/* 6: ショートカット */}
          <div className="help-section">
            <h3>キーボードショートカット</h3>
            <table className="help-table">
              <tbody>
                <tr><td>Esc</td><td>選択解除 / ヘルプを閉じる</td></tr>
                <tr><td>検索ボックスでEnter</td><td>次の検索結果へ移動</td></tr>
              </tbody>
            </table>
            <h3>ミニマップ</h3>
            <p>画面右下のミニマップをクリックすると、その位置にジャンプできます。現在の表示範囲が水色の矩形で示されます。</p>
            <h3>対応ファイル形式一覧</h3>
            <table className="help-table">
              <tbody>
                <tr><td>DXF</td><td>AutoCAD図面(ASCII/Shift-JIS/UTF-8自動判定)</td></tr>
                <tr><td>PDF</td><td>図面PDF(ピクセル差分・テキスト差分)</td></tr>
                <tr><td>IGES</td><td>汎用CAD交換フォーマット</td></tr>
                <tr><td>STL</td><td>3Dプリンタ用メッシュ(ASCII/バイナリ)</td></tr>
                <tr><td>OBJ</td><td>3Dメッシュ(Wavefront)</td></tr>
                <tr><td>STEP</td><td>3D CAD標準フォーマット(平面近似表示)</td></tr>
                <tr><td>PLY</td><td>点群・メッシュ(ASCII/バイナリ)</td></tr>
                <tr><td>OFF</td><td>Object File Format</td></tr>
                <tr><td>画像</td><td>PNG / JPG(ピクセル差分比較)</td></tr>
              </tbody>
            </table>
            <div className="help-tip">DWGはAutoCADで「名前を付けて保存→DXF形式」に変換してください。SLDPRTはSolidWorksで「名前を付けて保存→STEP形式」に変換してください。</div>
          </div>

        </div>
      </div>
    </div>
  )
}
