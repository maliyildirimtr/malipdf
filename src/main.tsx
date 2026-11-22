import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { isIpadApp } from './platform/native';
import { createIpadBridge } from './platform/ipadBridge';
import { setUpOverlayTitleBar } from './platform/titleBar';

// iPad app: the desktop shell's API is provided on top of the iOS plugins,
// and the page is laid out for touch (no browser zoom; pinch zooms the PDF).
if (isIpadApp()) {
  window.electronAPI = createIpadBridge();
  document.documentElement.classList.add('platform-ipad');
  document.querySelector('meta[name="viewport"]')?.setAttribute(
    'content',
    'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
  );
}

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

// Windows / Linux: the tab bar is the title bar (no separate menu bar).
const shellPlatform = window.electronAPI?.platform;
if (shellPlatform === 'win32' || shellPlatform === 'linux') setUpOverlayTitleBar();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
