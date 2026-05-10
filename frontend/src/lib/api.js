import { supabase } from './supabase';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchApi(endpoint, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  
  const headers = {
    ...(options.headers || {}),
  };

  // Only set application/json if we are not sending FormData
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Unauthorized - token might be expired
    await supabase.auth.signOut();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.detail || data.message || 'API request failed');
  }

  return data;
}
