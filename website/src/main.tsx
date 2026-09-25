import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';

// Skip link styles (inlined to be available before any component CSS)
const skipLinkStyle = document.createElement('style');
skipLinkStyle.textContent = `
  .skip-link {
    position: absolute;
    top: -100%;
    left: var(--space-4, 16px);
    background-color: var(--accent, #2d5fa8);
    color: #fff;
    padding: 10px 20px;
    border-radius: 0 0 var(--radius-md, 8px) var(--radius-md, 8px);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    z-index: 9999;
    transition: top 0.2s ease;
  }
  .skip-link:focus {
    top: 0;
  }
`;
document.head.appendChild(skipLinkStyle);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
