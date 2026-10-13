import { io } from 'socket.io-client';

const rawApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '');
const backendUrl = rawApiUrl || undefined;

if (!backendUrl && typeof window !== 'undefined') {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocal) {
    console.warn(
      '[Socket] Warning: VITE_API_URL environment variable is not set. ' +
      'Connecting to current origin (' + window.location.origin + '). ' +
      'If your backend is hosted on Render, Railway, or VPS, set VITE_API_URL in Vercel project settings.'
    );
  }
}

/**
 * Singleton socket.io-client instance.
 * Connects to the configured backend, or the same origin for local development.
 * Uses websocket first with polling fallback for optimal cross-origin reliability.
 */
const socket = io(backendUrl, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  transports: ['websocket', 'polling'],
  withCredentials: true,
});

export function ensureSocketConnected(timeoutMs = 12000) {
  if (socket.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(new Error(error?.message || 'Unable to connect to the backend server.'));
    };

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Socket connection timed out.'));
    }, timeoutMs);

    if (!socket.connected) {
      socket.connect();
    }
  });
}

export default socket;
