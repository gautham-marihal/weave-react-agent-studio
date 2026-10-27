import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
// Inter, self-hosted so no request leaves the app for it.
import '@fontsource-variable/inter';
// IBM Plex for the Studio style (src/themes.css), fetched only when a page uses that style.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import { TipProvider } from './ui/Tip.tsx';
import './tokens.css';
import './styles.css';
import './appLook.css';
import './saas.css';
import './themes.css';
import './accents.css';
import './tailwind.css';
import { App, AppErrorBoundary } from './App.jsx';
import { watchScrollEdges } from './ui/scrollEdges.js';
import { queryClient } from './api/queryClient.ts';

// Every scroll area fades an edge that has more content past it, so nothing looks cut off.
watchScrollEdges();

// The data cache every page reads through (src/api/queryClient.ts).
createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TipProvider>
        <App />
      </TipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>,
);
