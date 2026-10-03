import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import socket from '../socket';
import OwnerChat from './OwnerChat';
import NotificationBell from './NotificationBell';

// ── Utility ─────────────────────────────────────────────────────────────────
function getAvatarColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 60%, 45%)`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * OwnerDashboard — Telegram-style chat list on the left, chat panel on the right.
 * On mobile (<700px): full-screen list → back button → full-screen chat.
 *
 * State tracked per visitor:
 *   visitors    — list from server (clientId, name, online)
 *   messages    — Map<clientId, Message[]>  (messages live only in React state)
 *   unread      — Map<clientId, number>
 *   lastMsg     — Map<clientId, { text, ts }>
 *   typing      — Map<clientId, bool>
 */
export default function OwnerDashboard() {
  const navigate  = useNavigate();
  const location  = useLocation();

  // ── State ──────────────────────────────────────────────────────────────────
  const [visitors,   setVisitors]   = useState(location.state?.visitors || []);
  const [selected,   setSelected]   = useState(null); // clientId of active chat
  const [messages,   setMessages]   = useState({});   // { [clientId]: Message[] }
  const [unread,     setUnread]     = useState({});   // { [clientId]: number }
  const [lastMsg,    setLastMsg]    = useState({});   // { [clientId]: { text, ts } }
  const [typing,     setTyping]     = useState({});   // { [clientId]: bool }
  const [showChat,   setShowChat]   = useState(false);// mobile: show chat panel

  const typingTimers = useRef({}); // per-visitor auto-clear timer for typing

  // ── Socket listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    // Reconnect owner if socket reconnects (e.g., page refresh isn't supported
    // on /owner/dash — owner must log in again, but we handle tab switching here)

    function onVisitorList(list) {
      setVisitors(list);
    }

    function onNewVisitor(visitor) {
      setVisitors((prev) => {
        const exists = prev.some((v) => v.clientId === visitor.clientId);
        if (exists) return prev.map((v) => v.clientId === visitor.clientId ? { ...v, ...visitor } : v);
        return [{ ...visitor }, ...prev];
      });
    }

    function onMsg({ text, ts, fromOwner, roomId }) {
      // Determine which visitor this message is from
      // roomId = "special-{clientId}"
      const cid = roomId?.replace('special-', '');
      if (!cid || fromOwner) return; // fromOwner = our own echo — skip

      setMessages((prev) => ({
        ...prev,
        [cid]: [...(prev[cid] || []), { id: `${ts}-${cid}`, text, fromMe: false, ts }],
      }));

      setLastMsg((prev) => ({ ...prev, [cid]: { text, ts } }));

      setUnread((prev) => ({
        ...prev,
        [cid]: selected === cid ? 0 : (prev[cid] || 0) + 1,
      }));
    }

    function onPeerTyping({ clientId: cid, roomId }) {
      const visitorCid = cid || roomId?.replace('special-', '');
      if (!visitorCid) return;
      setTyping((prev) => ({ ...prev, [visitorCid]: true }));
      clearTimeout(typingTimers.current[visitorCid]);
      typingTimers.current[visitorCid] = setTimeout(() => {
        setTyping((prev) => ({ ...prev, [visitorCid]: false }));
      }, 4000);
    }

    function onPeerStopTyping({ clientId: cid, roomId }) {
      const visitorCid = cid || roomId?.replace('special-', '');
      if (!visitorCid) return;
      clearTimeout(typingTimers.current[visitorCid]);
      setTyping((prev) => ({ ...prev, [visitorCid]: false }));
    }

    function onPeerOnline() {
      // Re-broadcast visitor list handles online state — nothing extra needed
    }

    function onPeerOffline() {
      // Same — handled via visitor-list broadcast
    }

    function onEnded() {
      // A visitor's room was ended (by the visitor themselves)
      // Visitor list update will follow from server
    }

    socket.on('visitor-list',      onVisitorList);
    socket.on('new-visitor',       onNewVisitor);
    socket.on('msg',               onMsg);
    socket.on('peer-typing',       onPeerTyping);
    socket.on('peer-stop-typing',  onPeerStopTyping);
    socket.on('peer-online',       onPeerOnline);
    socket.on('peer-offline',      onPeerOffline);
    socket.on('ended',             onEnded);

    return () => {
      socket.off('visitor-list',     onVisitorList);
      socket.off('new-visitor',      onNewVisitor);
      socket.off('msg',              onMsg);
      socket.off('peer-typing',      onPeerTyping);
      socket.off('peer-stop-typing', onPeerStopTyping);
      socket.off('peer-online',      onPeerOnline);
      socket.off('peer-offline',     onPeerOffline);
      socket.off('ended',            onEnded);
    };
  }, [selected]);

  // ── Open a visitor chat ──────────────────────────────────────────────────
  function openChat(clientId) {
    setSelected(clientId);
    setUnread((prev) => ({ ...prev, [clientId]: 0 }));
    setShowChat(true);
  }

  // ── Owner sends a message ────────────────────────────────────────────────
  function sendMessage(clientId, text) {
    const roomId = `special-${clientId}`;
    const ts = Date.now();
    socket.emit('msg', { roomId, clientId: 'owner', text });
    setMessages((prev) => ({
      ...prev,
      [clientId]: [...(prev[clientId] || []), { id: `${ts}-owner`, text, fromMe: true, ts }],
    }));
    setLastMsg((prev) => ({ ...prev, [clientId]: { text: `You: ${text}`, ts } }));
  }

  // ── Owner types ──────────────────────────────────────────────────────────
  function emitTyping(clientId) {
    socket.emit('typing', { roomId: `special-${clientId}`, clientId: 'owner' });
  }

  function emitStopTyping(clientId) {
    socket.emit('stop-typing', { roomId: `special-${clientId}` });
  }

  // ── End a visitor's chat ─────────────────────────────────────────────────
  function endVisitorChat(clientId) {
    socket.emit('end', { roomId: `special-${clientId}`, clientId: 'owner' });
    setVisitors((prev) => prev.filter((v) => v.clientId !== clientId));
    if (selected === clientId) { setSelected(null); setShowChat(false); }
  }

  // ── Rename a visitor ────────────────────────────────────────────────────
  function renameVisitor(clientId, name) {
    socket.emit('rename-visitor', { clientId, name });
  }

  const selectedVisitor = visitors.find((v) => v.clientId === selected);

  return (
    <div className="dashboard">
      {/* ── Left: Visitor list ── */}
      <div className={`visitor-list-panel ${showChat ? 'hidden' : ''}`}>
        {/* Header */}
        <div className="visitor-list-header">
          <h2>Chatroom</h2>
          <NotificationBell isOwner />
        </div>

        {/* List body */}
        <div className="visitor-list-body">
          {visitors.length === 0 ? (
            <div className="visitor-empty">
              <div className="visitor-empty-icon">💬</div>
              <p>No visitors yet.<br />When someone connects via Special Access, they'll appear here.</p>
            </div>
          ) : (
            visitors.map((v) => {
              const isTyping = typing[v.clientId];
              const last     = lastMsg[v.clientId];
              const badge    = unread[v.clientId] || 0;
              return (
                <button
                  key={v.clientId}
                  className={`visitor-row ${selected === v.clientId ? 'active' : ''}`}
                  onClick={() => openChat(v.clientId)}
                  id={`visitor-row-${v.clientId}`}
                  aria-label={`Chat with ${v.name}`}
                >
                  {/* Avatar */}
                  <div className="v-avatar" style={{ background: getAvatarColor(v.clientId) }}>
                    {v.name[0].toUpperCase()}
                    {v.online && <div className="v-online-dot" />}
                  </div>

                  {/* Info */}
                  <div className="v-info">
                    <div className="v-name">{v.name}</div>
                    <div className={`v-preview ${isTyping ? 'typing' : ''}`}>
                      {isTyping ? 'typing…' : last ? last.text : 'No messages yet'}
                    </div>
                  </div>

                  {/* Right: time + badge */}
                  <div className="v-right">
                    {last && <div className="v-time">{formatTime(last.ts)}</div>}
                    {badge > 0 && <div className="v-badge">{badge > 99 ? '99+' : badge}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Chat panel ── */}
      <div className="owner-chat-panel">
        {selected && selectedVisitor ? (
          <OwnerChat
            visitor={selectedVisitor}
            messages={messages[selected] || []}
            isTyping={!!typing[selected]}
            onSend={(text) => sendMessage(selected, text)}
            onTyping={() => emitTyping(selected)}
            onStopTyping={() => emitStopTyping(selected)}
            onEnd={() => endVisitorChat(selected)}
            onRename={(name) => renameVisitor(selected, name)}
            onBack={() => { setShowChat(false); setSelected(null); }}
          />
        ) : (
          <div className="no-chat-selected">
            <div className="no-chat-selected-icon">💬</div>
            <h3>Select a conversation</h3>
            <p>Pick a visitor from the list to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}
