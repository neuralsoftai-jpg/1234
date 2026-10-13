import { io } from 'socket.io-client';

const backendUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || undefined;

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

export default socket;
