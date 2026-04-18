import { useEffect, useState } from 'react'
import Header from './components/Header'
import DropRow from './components/DropRow'
import TabBar from './components/TabBar'
import BodyArea from './components/BodyArea'
import HelpModal from './components/HelpModal'
import MobileWarn from './components/MobileWarn'
import AuthBar from './components/AuthBar'

export default function App() {
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerError, setViewerError] = useState(null)

  useEffect(() => {
    // Dynamically import the legacy viewer *after* the React tree has mounted,
    // so document.getElementById() calls during the viewer's init IIFE find
    // their DOM targets.
    let cancelled = false
    import('./lib/viewer.js')
      .then(() => {
        if (!cancelled) setViewerReady(true)
      })
      .catch((err) => {
        console.error('[App] Failed to load viewer module:', err)
        if (!cancelled) setViewerError(err)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <MobileWarn />

      <div id="tooltip">
        <div className="tt-type" id="ttType"></div>
        <div id="ttBody"></div>
      </div>

      <Header authSlot={<AuthBar />} />
      <DropRow />
      <TabBar />
      <BodyArea />

      {/* Hidden container referenced by legacy init() */}
      <div id="layersPanelWrap" style={{ display: 'none', position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }} />

      <HelpModal />

      <div id="copyright">Copyright © 2026 ROBA★STAR（驢馬星）</div>

      {viewerError && (
        <div style={{
          position: 'fixed',
          bottom: '30px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(255,61,90,0.15)',
          border: '1px solid #ff3d5a',
          color: '#ff8898',
          padding: '8px 16px',
          fontFamily: 'var(--mono)',
          fontSize: '12px',
          borderRadius: '4px',
          zIndex: 9999
        }}>
          Viewer load failed: {viewerError.message}
        </div>
      )}
    </>
  )
}
