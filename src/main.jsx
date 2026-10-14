import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App, AppErrorBoundary } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
