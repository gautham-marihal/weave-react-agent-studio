import React from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './styles.css';
import './appLook.css';
import './themes.css';
import './accents.css';
import { App, AppErrorBoundary } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
