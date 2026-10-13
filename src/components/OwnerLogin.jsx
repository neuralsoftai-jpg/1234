import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket, { ensureSocketConnected } from '../socket';

/**
 * OwnerLogin — hidden page at /owner.
 * Not linked from the home screen.
 * Authenticates the owner with OWNER_KEY (compared server-side with timingSafeEqual).
 * Rate-limited to 5 attempts per 10 minutes per IP.
 */
export default function OwnerLogin() {
  const navigate    = useNavigate();
  const [key, setKey]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    if (!key.trim()) { setError('Please enter your owner key.'); return; }

    setLoading(true);
    setError('');

    function onReady({ visitors }) {
      cleanup();
      navigate('/owner/dash', { state: { visitors } });
    }

    function onFailed(msg) {
      cleanup();
      setError(msg);
      setLoading(false);
    }

    function cleanup() {
      clearTimeout(timeout);
      socket.off('owner-ready', onReady);
      socket.off('login-failed', onFailed);
      socket.off('connect_error', onConnectionError);
    }

    function onConnectionError() {
      cleanup();
      setLoading(false);
      setError('Unable to connect to the chat server. Please try again.');
    }

    socket.once('owner-ready', onReady);
    socket.once('login-failed', onFailed);
    const timeout = setTimeout(() => {
      cleanup();
      setLoading(false);
      setError('Login timed out. Please try again.');
    }, 10000);
    try {
      await ensureSocketConnected();
      socket.emit('owner-login', { key: key.trim() });
    } catch (_error) {
      onConnectionError();
    }
  }

  return (
    <div className="owner-login">
      <div className="owner-login-card">
        <div className="owner-login-icon" role="img" aria-label="Owner login">🔐</div>

        <h1 style={{ fontSize: 22, fontWeight: 700, textAlign: 'center', marginBottom: 6 }}>
          Owner Access
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 28 }}>
          Enter your secret key to manage visitor chats.
        </p>

        {error && (
          <div className="error-msg" role="alert" style={{ marginBottom: 20 }}>⚠️ {error}</div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label" htmlFor="owner-key-input">Owner Key</label>
            <input
              id="owner-key-input"
              className="form-input"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your secret key"
              value={key}
              onChange={(e) => { setError(''); setKey(e.target.value); }}
              disabled={loading}
              autoFocus
              aria-label="Owner secret key"
            />
          </div>

          <button
            id="owner-login-btn"
            type="submit"
            className="btn-primary"
            disabled={loading || !key.trim()}
          >
            {loading ? 'Verifying…' : 'Login →'}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
          5 wrong attempts = 10-minute lockout per IP
        </p>
      </div>
    </div>
  );
}
