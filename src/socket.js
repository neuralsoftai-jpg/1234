import { io } from 'socket.io-client';

/**
 * Singleton socket.io-client instance.
 * Connects to the same origin (Express serves both the app and socket.io).
 * Auto-reconnects indefinitely — the server keeps rooms alive so clients
 * can always reattach after a network hiccup.
 */
const socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

export default socket;
