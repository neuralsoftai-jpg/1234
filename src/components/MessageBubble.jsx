/**
 * MessageBubble — renders a single chat message.
 * Outgoing (fromMe=true) appears on the right in green/blue.
 * Incoming appears on the left in white/dark.
 */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ text, fromMe, ts, delivered }) {
  return (
    <div className={`bubble-row ${fromMe ? 'out' : 'in'}`}>
      <div className={`bubble ${fromMe ? 'out' : 'in'}`}>
        {/* Message text — whitespace preserved, HTML escaped by React */}
        <span className="bubble-text">{text}</span>

        {/* Timestamp + check marks */}
        <div className="bubble-meta">
          <span className="bubble-time">{formatTime(ts)}</span>
          {fromMe && (
            <span className={`bubble-check ${delivered ? 'delivered' : 'sent'}`} aria-label={delivered ? 'Delivered' : 'Sent'}>
              {delivered ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
