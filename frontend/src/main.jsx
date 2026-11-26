import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './tokens.css';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { App } from './App.jsx';

const fontsLink = document.getElementById('google-fonts-css');
if (fontsLink && fontsLink.media !== 'all') {
  if (fontsLink.sheet) {
    fontsLink.media = 'all';
  } else {
    fontsLink.addEventListener(
      'load',
      () => {
        fontsLink.media = 'all';
      },
      { once: true },
    );
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
}
