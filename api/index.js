import { getVapidPublicKey } from '../vapid.js';

export default function handler(_req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ publicKey: getVapidPublicKey() });
  } catch (error) {
    console.error('[VAPID] Public key initialization failed:', error);
    res.status(503).json({ error: 'Push notifications are temporarily unavailable.' });
  }
}
