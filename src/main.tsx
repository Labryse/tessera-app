import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/hanken-grotesk';
import './styles/tokens.css';
import './styles/app.css';
import './styles/layout.css';
import './styles/layers.css';
import './styles/detail.css';
import './styles/retro.css';
import './styles/big.css';
import './styles/themes.css';
import './styles/features.css';
import './styles/showcase.css';
import './styles/studio.css';
import App from './App';
import { installErrorCatch } from './lib/errors';

installErrorCatch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
