import { useState, useEffect, useRef, useCallback } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import NotificationBell from './NotificationBell';

function getAvatarColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 60%, 45%)`;
}

/**
 * OwnerChat — the right-panel chat view for the owner.
 * Receives messages as props from OwnerDashboard (single source of truth).
 *
 * Props:
 *   visitor     { clientId, name, online }
 *   messages    Message[]
 *   isTyping    bool
 *   onSend(text)
 *   onTyping()
 *   onStopTyping()
 *   onEnd()
 *   onRename(name)
 *   onBack()    — mobile back-to-list
 */
export default function OwnerChat({
  visitor, messages, isTyping,
  onSend, onTyping, onStopTyping, onEnd, onRename, onBack,
}) {
  const [inputText,  setInputText]  = useState('');
  const [renaming,   setRenaming]   = useState(false);
  const [newName,    setNewName]    = useState(visitor.name);
  const messagesEndRef = useRef(null);
  const typingTimerRef = useRef(null);
  const lastTypingEmit = useRef(0);
  const textareaRef    = useRef(null);

  // ── Auto-scroll on new messages / typing ────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isTyping, scrollToBottom]);

  // ── Sync name when visitor prop updates ──────────────────────────────────
  useEffect(() => { setNewName(visitor.name); }, [visitor.name]);

  // ── Auto-resize textarea ─────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [inputText]);

  // ── Typing emission ───────────────────────────────────────────────────────
  function handleInputChange(e) {
    setInputText(e.target.value);
    const now = Date.now();
    if (now - lastTypingEmit.current > 1500) {
      onTyping();
      lastTypingEmit.current = now;
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => onStopTyping(), 3000);
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  function sendMessage() {
    const text = inputText.trim();
    if (!text) return;
    clearTimeout(typingTimerRef.current);
    onStopTyping();
    lastTypingEmit.current = 0;
    onSend(text);
    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  // ── Rename submit ─────────────────────────────────────────────────────────
  function submitRename(e) {
    e?.preventDefault();
    const n = newName.trim();
    if (n && n !== visitor.name) onRename(n);
    setRenaming(false);
  }

  const avatarColor = getAvatarColor(visitor.clientId);

  return (
    <div className="chat-screen" style={{ flex: 1 }}>
      {/* Header */}
      <header className="chat-header">
        {/* Mobile back button */}
        <button
          className="header-back"
          onClick={onBack}
          id="owner-chat-back-btn"
          aria-label="Back to visitor list"
          style={{ display: 'flex' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="header-avatar" style={{ background: avatarColor }}>
          {visitor.name[0].toUpperCase()}
        </div>

        <div className="header-info">
          {renaming ? (
            <form onSubmit={submitRename} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="rename-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={submitRename}
                autoFocus
                maxLength={30}
                aria-label="Rename visitor"
              />
              <button type="submit" style={{ color: '#fff', fontSize: 20 }}>✓</button>
            </form>
          ) : (
            <button
              className="header-name"
              onClick={() => setRenaming(true)}
              style={{ background: 'none', border: 'none', cursor: 'text', textAlign: 'left', display: 'block' }}
              title="Click to rename"
              aria-label={`Rename ${visitor.name}`}
              id={`rename-btn-${visitor.clientId}`}
            >
              {visitor.name} ✏️
            </button>
          )}
          <div className={`header-status ${isTyping ? 'typing' : visitor.online ? 'online' : ''}`}>
            {isTyping ? 'typing…' : visitor.online ? 'online' : 'offline'}
          </div>
        </div>

        <div className="header-actions">
          <NotificationBell isOwner />
          <button
            className="end-btn"
            onClick={onEnd}
            id={`end-visitor-btn-${visitor.clientId}`}
            aria-label={`End chat with ${visitor.name}`}
            style={{ marginLeft: 8, flexShrink: 0 }}
          >
            End chat
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="chat-messages" role="log" aria-live="polite" aria-label={`Chat with ${visitor.name}`}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, margin: 'auto', padding: 40 }}>
            No messages yet — messages are not stored. 👋
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            text={msg.text}
            fromMe={msg.fromMe}
            ts={msg.ts}
            delivered={msg.fromMe && visitor.online}
          />
        ))}

        {isTyping && (
          <div className="bubble-row in">
            <TypingIndicator />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="chat-inputbar">
        <div className="chat-input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-input"
            rows={1}
            placeholder={`Message ${visitor.name}…`}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            aria-label="Type a message"
            id={`owner-msg-input-${visitor.clientId}`}
          />
        </div>
        <button
          className="send-btn"
          onClick={sendMessage}
          disabled={!inputText.trim()}
          aria-label="Send message"
          id={`owner-send-btn-${visitor.clientId}`}
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
