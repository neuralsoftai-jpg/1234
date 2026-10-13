import { io } from 'socket.io-client';

const backendUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '') || undefined;

/**
 * Singleton socket.io-client instance.
 * Connects to the configured backend, or the same origin for local development.
 * Auto-reconnects indefinitely — the server keeps rooms alive so clients
 * can always reattach after a network hiccup.
 */
const socket = io(backendUrl, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

export function ensureSocketConnected(timeoutMs = 10000) {
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
      reject(error);
    };

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Socket connection timed out.'));
    }, timeoutMs);
    socket.connect();
  });
}

export default socket;
