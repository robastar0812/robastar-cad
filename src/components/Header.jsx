// Header section — mode selector, color mode, language switcher,
// DXF encoding selector, help/collapse toggle. All handlers delegate to
// the legacy viewer (attached to window.* by src/lib/viewer.js).

export default function Header({ authSlot }) {
  return (
    <>
      <header>
        <div className="logo">
          <svg viewBox="0 0 16 16" fill="none" stroke="#00b4ff" strokeWidth="1.5">
            <rect x="1" y="1" width="14" height="14" rx="1" />
            <line x1="1" y1="6" x2="15" y2="6" />
            <line x1="6" y1="6" x2="6" y2="15" />
            <line x1="9" y1="10" x2="13" y2="10" />
            <line x1="9" y1="13" x2="13" y2="13" />
          </svg>
        </div>
        <div>
          <div className="h-title">ROBA★STAR DIFF</div>
          <div className="h-sub">図面解析・差分比較システム</div>
        </div>
        <button id="hdrHelpBtn" onClick={() => window.showHelp?.()} title="操作説明">
          <span style={{
            fontFamily: 'Arial,sans-serif',
            fontSize: '14px',
            fontWeight: 900,
            lineHeight: 1,
            marginTop: '1px',
            display: 'block'
          }}>?</span>
        </button>
        <button id="hdrCloseBtn" onClick={() => window.toggleHeader?.()}>▲ 閉じる</button>
        <div className="h-mode">
          <button className="mode-btn active" id="modeBtn1" onClick={() => window.setMode?.('single')}>
            単体展開
          </button>
          <button className="mode-btn" id="modeBtn2" onClick={() => window.setMode?.('diff')}>
            差分比較
          </button>
        </div>
        <div className="color-mode-bar">
          <button className="cmode-btn active" id="cmBtn1" onClick={() => window.setColorMode?.('semantic')} title="iCADスタイル自動色分け">
            ■ 意味色
          </button>
          <button className="cmode-btn" id="cmBtn2" onClick={() => window.setColorMode?.('layer')} title="レイヤー色">
            レイヤー
          </button>
        </div>

        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontFamily: 'var(--mono)',
          fontSize: '11px',
          color: 'var(--dim)',
          flexShrink: 0,
          whiteSpace: 'nowrap'
        }}>
          <span style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
            {['ja', 'en', 'th', 'zh', 'vi'].map((l, i) => (
              <button
                key={l}
                onClick={() => window.switchLang?.(l)}
                data-lang={l}
                className={`lang-btn${l === 'ja' ? ' active-lang' : ''}`}
                style={{
                  padding: '1px 5px',
                  fontSize: '12px',
                  background: '#1a2a3a',
                  border: '1px solid #334',
                  color: '#8af',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontFamily: l === 'th' ? "'Noto Sans Thai',sans-serif" : undefined
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </span>
          <select
            id="encSelect"
            title="文字コード"
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontFamily: 'var(--mono)',
              fontSize: '11px',
              padding: '2px 4px',
              cursor: 'pointer',
              maxWidth: '80px'
            }}
            onChange={() => window.rerun?.()}
            defaultValue="auto"
          >
            <option value="auto">自動</option>
            <option value="shift-jis">Shift-JIS</option>
            <option value="utf-8">UTF-8</option>
            <option value="utf-16le">UTF-16LE</option>
            <option value="euc-jp">EUC-JP</option>
          </select>
          {authSlot}
        </div>
      </header>
      <button id="hdrOpenBtn" onClick={() => window.toggleHeader?.()}>▼ メニュー</button>
    </>
  )
}
