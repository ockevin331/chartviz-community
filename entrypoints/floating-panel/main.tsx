import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
);

// Let the host-page shell remove its startup cover only after React has had a
// chance to commit visible content. This also turns module-load failures into a
// readable error instead of an empty black panel.
window.requestAnimationFrame(() => {
  window.parent.postMessage({ source: 'chartviz', type: 'panel-ready' }, '*');
});
