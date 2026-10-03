import { useState, useEffect, useRef } from 'react';
import socket from '../socket';

/**
 * NotificationBell — subscribes the browser to Web Push.
 * Works inside the header of any screen (Chat, OwnerDashboard, Home).
 *
 * Props:
 *   clientId  — the user's clientId (undefined for pre-join home screen)
 *   isOwner   — pass true on the owner dashboard
 */
export default function NotificationBell({ clientId, isOwner = false }) {
  const [status, setStatus]   = useState('idle'); // 'idle' | 'subscribed' | 'denied' | 'unsupported'
  const [ringing, setRinging] = useState(false);
  const [tip, setTip]         = useState('');
  const tipTimer              = useRef(null);

  // On mount, check existing permission / subscription
  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') { setStatus('denied'); return; }
    if (Notification.permission === 'granted') {
      // Check if already subscribed
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => {
          if (sub) setStatus('subscribed');
        })
      );
    }
  }, []);

  async function handleBellClick() {
    if (status === 'unsupported') {
      showTip('Push not supported in this browser');
      return;
    }
    if (status === 'denied') {
      showTip('Notifications blocked — enable in browser settings');
      return;
    }
    if (status === 'subscribed') {
      showTip('Notifications already on ✓');
      ringBell();
      return;
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setStatus('denied'); showTip('Permission denied'); return; }

    try {
      // Fetch VAPID public key from server
      const res = await fetch('/api/vapid-public-key');
      const { publicKey } = await res.json();

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to server
      socket.emit('sub', { subscription, clientId, isOwner });
      setStatus('subscribed');
      showTip('Notifications enabled ✓');
      ringBell();
    } catch (err) {
      console.warn('[Push] Subscription failed:', err);
      showTip('Failed to enable notifications');
    }
  }

  function ringBell() {
    setRinging(true);
    setTimeout(() => setRinging(false), 700);
  }

  function showTip(msg) {
    setTip(msg);
    clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => setTip(''), 3000);
  }

  const subscribed = status === 'subscribed';

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className={`bell-btn ${subscribed ? 'subscribed' : ''}`}
        onClick={handleBellClick}
        aria-label={subscribed ? 'Notifications on' : 'Enable notifications'}
        id="notification-bell-btn"
        title={subscribed ? 'Notifications on' : 'Enable notifications'}
      >
        <svg
          className={`bell-icon ${ringing ? 'bell-ring' : ''}`}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {subscribed ? (
            /* Filled bell when subscribed */
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" fill="currentColor" />
          ) : (
            /* Outline bell */
            <>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </>
          )}
        </svg>
      </button>

      {tip && (
        <div className="bell-tooltip" role="tooltip">{tip}</div>
      )}
    </div>
  );
}

// ── Utility: convert base64url VAPID key to Uint8Array ────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
