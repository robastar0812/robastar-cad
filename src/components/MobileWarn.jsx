import { useEffect, useState } from 'react'

export default function MobileWarn() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (window.innerWidth < 600) setVisible(true)
  }, [])

  if (!visible) return null

  return (
    <div id="mobileWarn" style={{ display: 'flex' }}>
      <div style={{ fontSize: '48px' }}>🦁</div>
      <div style={{ fontFamily: 'monospace', fontSize: '18px', color: '#00b4ff', fontWeight: 'bold' }}>
        ROBA★STAR CAD
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#667788', textAlign: 'center', lineHeight: 1.8 }}>
        本アプリはPC・タブレット専用です<br />
        This app requires a tablet or PC<br />
        แอปนี้รองรับเฉพาะแท็บเล็ตหรือ PC<br />
        此应用仅支持平板或PC
      </div>
      <button
        onClick={() => setVisible(false)}
        style={{
          padding: '10px 32px',
          background: 'rgba(0,180,255,0.15)',
          border: '1px solid rgba(0,180,255,0.5)',
          borderRadius: '8px',
          color: '#00b4ff',
          fontFamily: 'monospace',
          fontSize: '14px',
          cursor: 'pointer',
          marginTop: '4px'
        }}
      >
        続ける / Continue
      </button>
      <div style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(0,180,255,0.4)' }}>
        Copyright © 2026 ROBA★STAR（驢馬星）
      </div>
    </div>
  )
}
