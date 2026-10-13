import { getVapidPublicKey } from '../vapid.js';

export default function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ publicKey: getVapidPublicKey() });
  } catch (error) {
    console.error('[VAPID] Public key initialization failed:', error);
    res.status(503).json({ error: 'Push notifications are temporarily unavailable.' });
  }
}
