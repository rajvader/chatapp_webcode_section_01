/**
 * Calls backend API (uses REACT_APP_MONGODB_URI / MONGODB_URI)
 */

const API = process.env.REACT_APP_API_URL || '';

const api = async (path, options = {}) => {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? JSON.parse(text) : {};
};

export const createUser = async (username, password) => {
  await api('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
};

export const findUser = async (username, password) => {
  const data = await api('/api/users/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return data.ok ? { username: data.username } : null;
};

export const saveMessage = async (username, role, content, imageData = null) => {
  const data = await api('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ username, role, content, imageData }),
  });
  return data.id;
};

export const loadMessages = async (username) => {
  const msgs = await api(`/api/messages?username=${encodeURIComponent(username)}`);
  return msgs;
};
