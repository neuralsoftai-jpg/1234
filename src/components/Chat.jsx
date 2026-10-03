import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import NotificationBell from './NotificationBell';

// ── Helpers ────────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getAvatarColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 65%, 45%)`;
}

/**
 * Chat screen — handles both normal (code-based) and special-access (visitor) chats.
 * Reads saved room info from localStorage and auto-reconnects on mount.
 */
export default function Chat() {
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages]     = useState([]);
  const [inputText, setInputText]   = useState('');
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [connected, setConnected]   = useState(false);
  const [ended, setEnded]           = useState(false);
  const [roomInfo, setRoomInfo]     = useState(null); // { type, code/roomId, clientId, peerName }
  const [peerDelivered, setPeerDelivered] = useState(false); // for double-check marks

  // ── Refs ───────────────────────────────────────────────────────────────────
  const messagesEndRef    = useRef(null);
  const typingTimerRef    = useRef(null);  // stop-typing after 3s idle
  const lastTypingEmit    = useRef(0);     // throttle typing emit to 1.5s
  const typingClearTimer  = useRef(null);  // auto-clear typing indicator after 4s
  const textareaRef       = useRef(null);

  // ── Scroll to bottom ────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, peerTyping, scrollToBottom]);

  // ── Socket reconnect on mount ───────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('chatroom_room');
    if (!saved) { navigate('/'); return; }

    let info;
    try { info = JSON.parse(saved); } catch { navigate('/'); return; }

    const { type, code, roomId, clientId, visitorName } = info;

    function onJoined({ roomId: rid, peerOnline: po, name }) {
      setConnected(true);
      setPeerOnline(po);
      setRoomInfo({
        type,
        roomId: rid || code,
        clientId,
        peerName: type === 'special' ? 'Owner' : 'Friend',
        visitorName: name || visitorName,
      });
    }

    function onSessionExpired() {
      localStorage.removeItem('chatroom_room');
      navigate('/');
    }

    socket.once('joined', onJoined);
    socket.once('session-expired', onSessionExpired);

    // Emit the appropriate rejoin event
    if (type === 'normal') {
      socket.emit('join', { code, clientId });
    } else if (type === 'special') {
      socket.emit('special-rejoin', { clientId });
    }

    return () => {
      socket.off('joined', onJoined);
      socket.off('session-expired', onSessionExpired);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket event listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!roomInfo) return;

    function onMsg({ text, ts, fromOwner }) {
      // Stop showing typing indicator when a message arrives
      clearTimeout(typingClearTimer.current);
      setPeerTyping(false);
      setPeerDelivered(true);

      setMessages((prev) => [
        ...prev,
        { id: `${ts}-${Math.random()}`, text, fromMe: false, ts },
      ]);
    }

    function onPeerOnline()  { setPeerOnline(true); setPeerDelivered(true); }
    function onPeerOffline() { setPeerOnline(false); }

    function onPeerTyping() {
      setPeerTyping(true);
      clearTimeout(typingClearTimer.current);
      typingClearTimer.current = setTimeout(() => setPeerTyping(false), 4000);
    }

    function onPeerStopTyping(_data) {
      clearTimeout(typingClearTimer.current);
      setPeerTyping(false);
    }

    function onEnded() {
      setEnded(true);
      localStorage.removeItem('chatroom_room');
      setTimeout(() => navigate('/'), 2500);
    }

    socket.on('msg',            onMsg);
    socket.on('peer-online',    onPeerOnline);
    socket.on('peer-offline',   onPeerOffline);
    socket.on('peer-typing',    onPeerTyping);
    socket.on('peer-stop-typing', onPeerStopTyping);
    socket.on('ended',          onEnded);

    return () => {
      socket.off('msg',            onMsg);
      socket.off('peer-online',    onPeerOnline);
      socket.off('peer-offline',   onPeerOffline);
      socket.off('peer-typing',    onPeerTyping);
      socket.off('peer-stop-typing', onPeerStopTyping);
      socket.off('ended',          onEnded);
    };
  }, [roomInfo, navigate]);

  // ── Textarea auto-resize ────────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [inputText]);

  // ── Typing event emission ───────────────────────────────────────────────────
  function handleInputChange(e) {
    setInputText(e.target.value);
    if (!roomInfo) return;

    const now = Date.now();
    if (now - lastTypingEmit.current > 1500) {
      socket.emit('typing', { roomId: roomInfo.roomId, clientId: roomInfo.clientId });
      lastTypingEmit.current = now;
    }

    // Reset stop-typing timer (fires after 3s of no input)
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit('stop-typing', { roomId: roomInfo.roomId });
    }, 3000);
  }

  // ── Send message ────────────────────────────────────────────────────────────
  function sendMessage() {
    const text = inputText.trim();
    if (!text || !roomInfo) return;

    // Clear typing state
    clearTimeout(typingTimerRef.current);
    socket.emit('stop-typing', { roomId: roomInfo.roomId });
    lastTypingEmit.current = 0;

    const ts = Date.now();
    // Optimistically add our own message
    setMessages((prev) => [
      ...prev,
      { id: `${ts}-me`, text, fromMe: true, ts },
    ]);

    socket.emit('msg', {
      roomId:   roomInfo.roomId,
      clientId: roomInfo.clientId,
      text,
    });

    setInputText('');
    textareaRef.current && (textareaRef.current.style.height = 'auto');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── End chat ────────────────────────────────────────────────────────────────
  function handleEnd() {
    if (!roomInfo) return;
    socket.emit('end', { roomId: roomInfo.roomId, clientId: roomInfo.clientId });
    localStorage.removeItem('chatroom_room');
    navigate('/');
  }

  // ── Render: loading state ───────────────────────────────────────────────────
  if (!connected && !ended) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100dvh', gap:16 }}>
        <div className="spinner" />
        <p style={{ color:'var(--text-secondary)', fontSize:14 }}>Reconnecting…</p>
      </div>
    );
  }

  // ── Render: chat ended ──────────────────────────────────────────────────────
  if (ended) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100dvh', gap:16, padding:32, textAlign:'center' }}>
        <div style={{ fontSize:56 }}>👋</div>
        <h2 style={{ fontSize:22, fontWeight:700 }}>Chat ended</h2>
        <p style={{ color:'var(--text-secondary)', fontSize:14 }}>Returning to home screen…</p>
      </div>
    );
  }

  const peerName    = roomInfo?.type === 'special' ? 'Owner' : 'Friend';
  const avatarColor = getAvatarColor(roomInfo?.roomId || 'chat');
  const avatarLetter = peerName[0].toUpperCase();

  return (
    <div className="chat-screen">
      {/* ── Header ── */}
      <header className="chat-header">
        <button className="header-back" onClick={() => navigate('/')} id="chat-back-btn" aria-label="Back to home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="header-avatar" style={{ background: avatarColor }}>
          {avatarLetter}
        </div>

        <div className="header-info">
          <div className="header-name">{peerName}</div>
          <div className={`header-status ${peerTyping ? 'typing' : peerOnline ? 'online' : ''}`}>
            {peerTyping ? 'typing…' : peerOnline ? 'online' : 'offline'}
          </div>
        </div>

        <div className="header-actions">
          <NotificationBell clientId={roomInfo?.clientId} />
          <button
            className="end-btn"
            onClick={handleEnd}
            id="end-chat-btn"
            aria-label="End this chat"
            style={{ marginLeft: 8 }}
          >
            End
          </button>
        </div>
      </header>

      {/* ── Messages ── */}
      <div className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && (
          <div style={{ textAlign:'center', color:'var(--text-secondary)', fontSize:13, margin:'auto', padding:40 }}>
            Messages are not stored. Say hello! 👋
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            text={msg.text}
            fromMe={msg.fromMe}
            ts={msg.ts}
            delivered={msg.fromMe && peerDelivered}
          />
        ))}

        {/* Typing indicator */}
        {peerTyping && (
          <div className="bubble-row in">
            <TypingIndicator />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="chat-inputbar">
        <div className="chat-input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-input"
            rows={1}
            placeholder="Message"
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            aria-label="Type a message"
            id="chat-message-input"
            disabled={ended}
          />
        </div>
        <button
          className="send-btn"
          onClick={sendMessage}
          disabled={!inputText.trim() || ended}
          aria-label="Send message"
          id="send-message-btn"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
