import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
// Inter, self-hosted (no request leaves the app for it): the typeface of the interface
import '@fontsource-variable/inter';
import { TipProvider } from './ui/Tip.tsx';
import './tokens.css';
import './styles.css';
import './appLook.css';
import './saas.css';
import './themes.css';
import './accents.css';
import { App, AppErrorBoundary } from './App.jsx';
import { watchScrollEdges } from './ui/scrollEdges.js';
import { queryClient } from './api/queryClient.ts';

// every scroll area fades the edge it has more past, so nothing is sliced by an edge unannounced
watchScrollEdges();

// the data cache every page reads through (src/api/queryClient.ts)
createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TipProvider>
        <App />
      </TipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>,
);
