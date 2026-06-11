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
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      // Do not reload for public auth endpoints so inline error messages can be displayed
      const url = error.config && error.config.url;
      if (url && (
        url.endsWith('/api/login') || 
        url.endsWith('/api/register') || 
        url.endsWith('/api/verify-email') ||
        url.endsWith('/api/forgot-password') ||
        url.endsWith('/api/reset-password')
      )) {
        return Promise.reject(error);
      }

      if (error.response.status === 403 && error.response.data?.error) {
        alert(error.response.data.error);
      }

      localStorage.removeItem('user');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

createRoot(document.getElementById('root')).render(
  <App />
)
