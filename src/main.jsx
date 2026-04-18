import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// NOTE: intentionally NOT wrapped in <StrictMode>. The legacy viewer.js
// init() IIFE attaches non-idempotent DOM listeners (setupZone, drop
// handlers, mouse listeners). StrictMode's double-invoke in dev would
// register them twice and misbehave. Once the viewer is fully React-ified,
// re-enable StrictMode.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
