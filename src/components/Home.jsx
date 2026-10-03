import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import NotificationBell from './NotificationBell';
import CreateChat from './CreateChat';
import JoinChat from './JoinChat';
import SpecialAccess from './SpecialAccess';

// ── Helper: generate or restore a persistent client ID ────────────────────────
function getClientId() {
  let id = localStorage.getItem('chatroom_clientId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('chatroom_clientId', id);
  }
  return id;
}

export default function Home() {
  const navigate = useNavigate();
  const [view, setView] = useState('home'); // 'home' | 'create' | 'join' | 'special'

  // On mount: check if we have a saved room — try to reconnect automatically
  useEffect(() => {
    const saved = localStorage.getItem('chatroom_room');
    if (!saved) return;
    const { type } = JSON.parse(saved);
    // Navigate to chat — Chat.jsx will handle the actual rejoin
    navigate('/chat', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (view === 'create')  return <CreateChat  onBack={() => setView('home')} getClientId={getClientId} />;
  if (view === 'join')    return <JoinChat    onBack={() => setView('home')} getClientId={getClientId} />;
  if (view === 'special') return <SpecialAccess onBack={() => setView('home')} getClientId={getClientId} />;

  return (
    <div className="home-screen" style={{ position: 'relative' }}>
      {/* Notification bell (top-right) */}
      <div className="home-bell" style={{ position: 'absolute', top: '20px', right: '20px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--primary)', display: 'flex',
            alignItems: 'center', justifyContent: 'center'
          }}>
            <NotificationBell clientId={getClientId()} />
          </div>
        </div>
      </div>

      {/* Logo */}
      <div className="home-logo">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
        </svg>
      </div>

      <h1 className="home-title">Chatroom</h1>
      <p className="home-subtitle">Anonymous. Private. No signup required.</p>

      <div className="home-options">
        {/* Create chat */}
        <button className="home-btn" id="btn-create" onClick={() => setView('create')}>
          <div className="home-btn-icon create">💬</div>
          <div>
            <div className="home-btn-label">Create chat</div>
            <div className="home-btn-desc">Get a 6-letter code to share</div>
          </div>
        </button>

        {/* Join chat */}
        <button className="home-btn" id="btn-join" onClick={() => setView('join')}>
          <div className="home-btn-icon join">🔗</div>
          <div>
            <div className="home-btn-label">Join chat</div>
            <div className="home-btn-desc">Enter a code to connect</div>
          </div>
        </button>

        {/* Special access */}
        <button className="home-btn" id="btn-special" onClick={() => setView('special')}>
          <div className="home-btn-icon special">⭐</div>
          <div>
            <div className="home-btn-label">Special access</div>
            <div className="home-btn-desc">Connect directly to the owner</div>
          </div>
        </button>
      </div>
    </div>
  );
}
