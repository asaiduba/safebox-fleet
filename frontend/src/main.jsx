import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import axios from 'axios'

// Add Axios Request Interceptor to attach JWT token
axios.interceptors.request.use(
  (config) => {
    try {
      const savedUser = localStorage.getItem('user');
      if (savedUser) {
        const userData = JSON.parse(savedUser);
        if (userData && userData.token) {
          config.headers.Authorization = `Bearer ${userData.token}`;
          if (userData.impersonating) {
            config.headers['X-Impersonate-User-Id'] = userData.id;
          }
        }
      }
    } catch (e) {
      console.error('Error reading token from localStorage:', e);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const url = error.config && error.config.url;
      const isPublicAuthUrl = url && (
        url.endsWith('/api/login') || 
        url.endsWith('/api/register') || 
        url.endsWith('/api/verify-email') ||
        url.endsWith('/api/forgot-password') ||
        url.endsWith('/api/reset-password')
      );

      if (error.response.status === 403) {
        if (!isPublicAuthUrl && error.response.data?.error) {
          alert(error.response.data.error);
        }
        return Promise.reject(error);
      }

      if (error.response.status === 401) {
        if (isPublicAuthUrl) {
          return Promise.reject(error);
        }
        localStorage.removeItem('user');
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);

createRoot(document.getElementById('root')).render(
  <App />
);

// Register Service Worker for PWA & Push Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered successfully:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}
