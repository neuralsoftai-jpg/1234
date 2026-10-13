import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAPID_FILE = join(__dirname, '.vapid.json');
const isVercel = process.env.VERCEL === '1';
let cachedKeys;

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
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

  if (publicKey || privateKey) {
    if (!publicKey || !privateKey) {
      throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together.');
    }
    return { publicKey, privateKey };
  }

  if (!isVercel && existsSync(VAPID_FILE)) {
    try {
      const fileKeys = JSON.parse(readFileSync(VAPID_FILE, 'utf8'));
      if (isValidKeys(fileKeys)) return fileKeys;
      throw new Error('The .vapid.json file does not contain valid keys.');
    } catch (error) {
      throw new Error(`Unable to read VAPID keys: ${error.message}`);
    }
  }

  const generatedKeys = webpush.generateVAPIDKeys();
  if (!isVercel) {
    try {
      writeFileSync(VAPID_FILE, JSON.stringify(generatedKeys), { flag: 'wx' });
      console.log('[VAPID] Generated and persisted new keys in .vapid.json');
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Unable to persist generated VAPID keys: ${error.message}`);
      }
    }
  } else {
    console.warn('[VAPID] Generated in memory on Vercel. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY for stable subscriptions.');
  }
  return generatedKeys;
}

export function getVapidKeys() {
  if (!cachedKeys) {
    cachedKeys = loadKeys();
    webpush.setVapidDetails(
      'mailto:admin@chatroom.local',
      cachedKeys.publicKey,
      cachedKeys.privateKey
    );
  }
  return cachedKeys;
}

export function getVapidPublicKey() {
  return getVapidKeys().publicKey;
}
