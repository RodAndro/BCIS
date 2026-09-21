import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { queryClient } from './lib/query-client';
import './styles.css';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('The application root element #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
