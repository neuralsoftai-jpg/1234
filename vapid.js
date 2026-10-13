import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAPID_FILE = join(__dirname, '.vapid.json');
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
let cachedKeys;

function cleanKey(val) {
  if (typeof val !== 'string') return '';
  return val.trim().replace(/^["']|["']$/g, '');
}

function isValidKeys(keys) {
  return Boolean(
    keys &&
    typeof keys.publicKey === 'string' &&
    keys.publicKey.length > 0 &&
    typeof keys.privateKey === 'string' &&
    keys.privateKey.length > 0
  );
}

function loadKeys() {
  const publicKey = cleanKey(process.env.VAPID_PUBLIC_KEY);
  const privateKey = cleanKey(process.env.VAPID_PRIVATE_KEY);

  if (publicKey || privateKey) {
    if (!publicKey || !privateKey) {
      throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set when configured via environment.');
    }
    return { publicKey, privateKey };
  }

  // If environment variables are not set, check .vapid.json
  if (existsSync(VAPID_FILE)) {
    try {
      const fileKeys = JSON.parse(readFileSync(VAPID_FILE, 'utf8'));
      if (isValidKeys(fileKeys)) {
        return fileKeys;
      }
      console.warn('[VAPID] Existing .vapid.json has invalid format; regenerating keys.');
    } catch (error) {
      console.warn(`[VAPID] Unable to read existing .vapid.json: ${error.message}`);
    }
  }

  // Automatic Key Generation
  console.log('[VAPID] Generating new VAPID keys...');
  const generatedKeys = webpush.generateVAPIDKeys();

  // Try to persist keys to .vapid.json (may fail in read-only environments like Vercel)
  try {
    writeFileSync(VAPID_FILE, JSON.stringify(generatedKeys, null, 2));
    console.log('[VAPID] Successfully generated and persisted new keys to .vapid.json');
  } catch (error) {
    console.warn(`[VAPID] Note: Unable to persist keys to .vapid.json (${error.message}). Using generated keys in memory.`);
  }

  if (isProduction) {
    console.warn(
      '[VAPID] Running in production with automatically generated keys.\n' +
      '       To keep push subscriptions valid across server restarts, please configure:\n' +
      `       VAPID_PUBLIC_KEY=${generatedKeys.publicKey}\n` +
      `       VAPID_PRIVATE_KEY=${generatedKeys.privateKey}`
    );
  }

  return generatedKeys;
}

export function getVapidKeys() {
  if (!cachedKeys) {
    cachedKeys = loadKeys();
    const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@chatroom.local';
    webpush.setVapidDetails(
      subject,
      cachedKeys.publicKey,
      cachedKeys.privateKey
    );
  }
  return cachedKeys;
}

export function getVapidPublicKey() {
  return getVapidKeys().publicKey;
}

