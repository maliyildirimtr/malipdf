import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// A file dropped anywhere that no component handles would make Chromium
// navigate the window to that file, replacing the app and discarding unsaved
// work. Components that accept drops call preventDefault themselves first.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

// Unexpected errors go into the local crash log, so a problem report has them.
const logError = (error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  void window.electronAPI?.logRendererError?.({ message: err.message, stack: err.stack })?.catch?.(() => {});
};
window.addEventListener('error', (event) => logError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => logError(event.reason));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
