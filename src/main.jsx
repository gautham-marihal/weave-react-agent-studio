import React from 'react';
import { createRoot } from 'react-dom/client';
// Inter, self-hosted (no request leaves the app for it): the typeface of the interface
import '@fontsource-variable/inter';
import './tokens.css';
import './styles.css';
import './appLook.css';
import './saas.css';
import './themes.css';
import './accents.css';
import { App, AppErrorBoundary } from './App.jsx';
import { watchScrollEdges } from './ui/scrollEdges.js';

// every scroll area fades the edge it has more past, so nothing is sliced by an edge unannounced
watchScrollEdges();

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
