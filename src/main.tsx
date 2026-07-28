import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadWorkspace } from './store';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

loadWorkspace().finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
