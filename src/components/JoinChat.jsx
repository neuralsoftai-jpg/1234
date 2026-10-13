import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket, { ensureSocketConnected } from '../socket';

export default function JoinChat({ onBack, getClientId }) {
  const navigate = useNavigate();
  const clientId = getClientId();

  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleJoin(e) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setError('Please enter the full 6-character code.');
      return;
    }

    setLoading(true);
    setError('');

    let joinTimer;

    function cleanup() {
      clearTimeout(joinTimer);
      socket.off('joined', onJoined);
      socket.off('error', onError);
    }

    function onJoined({ roomId, peerOnline }) {
      cleanup();
      localStorage.setItem('chatroom_room', JSON.stringify({
        type: 'normal', code: trimmed, clientId
      }));
      navigate('/chat', {
        state: {
          initialRoomInfo: {
            type: 'normal',
            roomId: roomId || trimmed,
            clientId,
            peerName: 'Friend',
          },
          initialPeerOnline: peerOnline,
        },
      });
    }

    function onError(msg) {
      cleanup();
      setError(msg || 'Failed to join room.');
      setLoading(false);
      localStorage.removeItem('chatroom_room');
    }

    socket.once('joined', onJoined);
    socket.once('error', onError);

    joinTimer = setTimeout(() => {
      cleanup();
      setError('Connection timed out. Please check your backend connection and try again.');
      setLoading(false);
      localStorage.removeItem('chatroom_room');
    }, 12000);

    try {
      await ensureSocketConnected();
      socket.emit('join', { code: trimmed, clientId });
    } catch (_err) {
      cleanup();
      setError('Unable to connect to chat server. Please verify backend is running.');
      setLoading(false);
      localStorage.removeItem('chatroom_room');
    }
  }

  return (
    <div className="panel-screen">
      <button className="panel-back" onClick={onBack} id="join-back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      <div className="panel-card">
        <h2 className="panel-title">Join a chat</h2>
        <p className="panel-desc">Enter the 6-character code shared by your friend.</p>

        {error && <div className="error-msg" role="alert">⚠️ {error}</div>}

        <form onSubmit={handleJoin}>
          <div className="form-group">
            <label className="form-label" htmlFor="join-code-input">Room Code</label>
            <input
              id="join-code-input"
              className="form-input code-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={6}
              placeholder="A1B2C3"
              value={code}
              onChange={(e) => {
                setError('');
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
              disabled={loading}
              aria-label="Enter room code"
            />
          </div>

          <button
            id="join-submit-btn"
            type="submit"
            className="btn-primary"
            disabled={loading || code.trim().length !== 6}
          >
            {loading ? 'Joining…' : 'Join chat →'}
          </button>
        </form>
      </div>
    </div>
  );
}
