import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';

export default function CreateChat({ onBack, getClientId }) {
  const navigate = useNavigate();
  const clientId = getClientId();

  const [code, setCode]         = useState('');
  const [copied, setCopied]     = useState(false);
  const [waiting, setWaiting]   = useState(true); // waiting for peer to join
  const [error, setError]       = useState('');

  useEffect(() => {
    // Ask server to create a room
    socket.emit('create', { clientId });

    function onCreated({ code: c }) {
      setCode(c);
      // Save to localStorage so Chat.jsx can reconnect
      localStorage.setItem('chatroom_room', JSON.stringify({
        type: 'normal', code: c, clientId
      }));
    }

    function onJoined({ roomId, peerOnline }) {
      if (peerOnline) {
        setWaiting(false);
        // Navigate to the chat screen — Chat.jsx will handle the room
        navigate('/chat');
      }
    }

    // Peer joined our room
    function onPeerOnline() {
      setWaiting(false);
      navigate('/chat');
    }

    function onError(msg) { setError(msg); }

    socket.on('room-created', onCreated);
    socket.on('joined', onJoined);
    socket.on('peer-online', onPeerOnline);
    socket.on('error', onError);

    return () => {
      socket.off('room-created', onCreated);
      socket.off('joined', onJoined);
      socket.off('peer-online', onPeerOnline);
      socket.off('error', onError);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCopy() {
    navigator.clipboard.writeText(code).catch(() => {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleBack() {
    localStorage.removeItem('chatroom_room');
    onBack();
  }

  return (
    <div className="panel-screen">
      <button className="panel-back" onClick={handleBack} id="create-back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      <div className="panel-card">
        <h2 className="panel-title">New chat room</h2>
        <p className="panel-desc">Share this code with a friend. They'll join automatically when they enter it.</p>

        {error && (
          <div className="error-msg" role="alert">⚠️ {error}</div>
        )}

        {code ? (
          <>
            <div className="code-display">
              <span className="code-value">{code}</span>
              <button
                className={`copy-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopy}
                id="copy-code-btn"
                aria-label="Copy room code"
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>

            {waiting ? (
              <div style={{ textAlign: 'center' }}>
                <div className="waiting-badge">
                  <div className="dot-pulse" />
                  Waiting for your friend to join…
                </div>
                <p className="panel-note">
                  Once your friend enters the code above, the chat will open automatically.
                </p>
              </div>
            ) : (
              <p className="panel-note" style={{ color: 'var(--online)' }}>
                ✓ Friend joined! Opening chat…
              </p>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
            <div className="spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
