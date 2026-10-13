import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket, { ensureSocketConnected } from '../socket';

export default function SpecialAccess({ onBack, getClientId }) {
  const navigate = useNavigate();
  const clientId = getClientId();

  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password.trim()) { setError('Please enter the access password.'); return; }

    let authTimer;

    function cleanup() {
      clearTimeout(authTimer);
      socket.off('joined', onJoined);
      socket.off('error', onError);
      socket.off('connect_error', onConnectError);
    }

    function onJoined({ roomId, peerOnline, name }) {
      cleanup();
      // Save for reconnect on refresh
      localStorage.setItem('chatroom_room', JSON.stringify({
        type: 'special', roomId, clientId, visitorName: name
      }));
      // Navigate with initial room info to skip redundant reconnect spinner
      navigate('/chat', {
        state: {
          initialRoomInfo: {
            type: 'special',
            roomId,
            clientId,
            peerName: 'Owner',
            visitorName: name,
          },
          initialPeerOnline: peerOnline,
        },
      });
    }

    function onError(msg) {
      cleanup();
      setError(msg || 'Authentication failed. Please try again.');
      setLoading(false);
    }

    function onConnectError(err) {
      cleanup();
      setError(err?.message || 'Unable to connect to the chat server. Please check connection.');
      setLoading(false);
    }

    socket.once('joined', onJoined);
    socket.once('error', onError);
    socket.once('connect_error', onConnectError);

    authTimer = setTimeout(() => {
      cleanup();
      setLoading(false);
      setError('Connection timed out. Please check your backend connection and try again.');
    }, 12000);

    try {
      await ensureSocketConnected();
      socket.emit('special-join', { password: password.trim(), clientId });
    } catch (_error) {
      cleanup();
      setLoading(false);
      setError('Unable to connect to the chat server. Please verify your backend server is running.');
    }
  }

  return (
    <div className="panel-screen">
      <button className="panel-back" onClick={onBack} id="special-back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      <div className="panel-card">
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 16 }}>⭐</div>
        <h2 className="panel-title" style={{ textAlign: 'center' }}>Special Access</h2>
        <p className="panel-desc" style={{ textAlign: 'center' }}>
          Enter the password to connect directly with the owner.
          No code sharing needed — you'll be connected instantly.
        </p>

        {error && <div className="error-msg" role="alert">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="special-pwd-input">Access Password</label>
            <input
              id="special-pwd-input"
              className="form-input"
              type="password"
              autoComplete="off"
              placeholder="Enter password"
              value={password}
              onChange={(e) => { setError(''); setPassword(e.target.value); }}
              disabled={loading}
              aria-label="Special access password"
            />
          </div>

          <button
            id="special-submit-btn"
            type="submit"
            className="btn-primary"
            disabled={loading || !password.trim()}
          >
            {loading ? 'Connecting…' : 'Connect →'}
          </button>
        </form>
      </div>
    </div>
  );
}
