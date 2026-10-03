/**
 * TypingIndicator — three bouncing dots inside an incoming-style bubble.
 * Pure CSS animation, respects prefers-reduced-motion.
 */
export default function TypingIndicator() {
  return (
    <div className="typing-bubble" aria-label="Peer is typing" role="status">
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  );
}
