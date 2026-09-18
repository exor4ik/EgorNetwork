/* ==========================================================================
   Муравейник — сквозное шифрование (только WebCrypto, без сторонних библиотек)

   Ключи пользователя (identity):
     • ECDH P-256  — согласование ключей (шифрование);
     • ECDSA P-256 — подпись каждого сообщения (подлинность отправителя).
   На устройстве приватные ключи хранятся в IndexedDB как НЕэкспортируемые
   CryptoKey: даже XSS не сможет вытащить их байты, только пользоваться ими,
   пока открыта вкладка.

   Сообщение («конверт»):
     1. случайный AES-256-GCM ключ CK на сообщение, AAD = chatId|msgId|sender;
     2. одноразовая эфемерная пара ECDH на сообщение; для каждого получателя
        (и самого отправителя) CK заворачивается ключом
        HKDF(ECDH(eph, recipient), info = chatId|msgId|uid);
     3. всё подписывается ECDSA-ключом отправителя.

   Бэкап ключей: AES-GCM ключом из PBKDF2(код восстановления, 600k итераций).
   Код — 160 случайных бит, генерируется на устройстве и НИГДЕ не хранится.

   Ограничение (честно): нет полной прямой секретности (Double Ratchet).
   Утечка приватного ключа получателя раскрывает сообщения, адресованные ему.
   ========================================================================== */

const subtle = crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const PROTO = 'anthill/v1';
const PBKDF2_ITER = 600000;

/* ── base64 ─────────────────────────────────────────────────────────────── */
export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(str) {
  if (typeof str !== 'string') throw new CryptoError('bad-encoding');
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export class CryptoError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/* ── Ключи пользователя ─────────────────────────────────────────────────── */
// Генерация: возвращает экспортированные ключи — ТОЛЬКО для записи бэкапа.
export async function generateIdentity() {
  const dh = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const sig = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const pub = {
    dh: toB64(await subtle.exportKey('spki', dh.publicKey)),
    sig: toB64(await subtle.exportKey('spki', sig.publicKey))
  };
  const priv = {
    dh: toB64(await subtle.exportKey('pkcs8', dh.privateKey)),
    sig: toB64(await subtle.exportKey('pkcs8', sig.privateKey))
  };
  return { pub, priv };
}

// Импорт приватных ключей как НЕэкспортируемых.
export async function importPrivate(priv) {
  return {
    dh: await subtle.importKey('pkcs8', fromB64(priv.dh), ECDH, false, ['deriveBits']),
    sig: await subtle.importKey('pkcs8', fromB64(priv.sig), ECDSA, false, ['sign'])
  };
}

const pubCache = new Map();
export async function importPublic(pub) {
  const k = pub.dh + '|' + pub.sig;
  if (pubCache.has(k)) return pubCache.get(k);
  const p = (async () => ({
    dh: await subtle.importKey('spki', fromB64(pub.dh), ECDH, false, []),
    sig: await subtle.importKey('spki', fromB64(pub.sig), ECDSA, false, ['verify'])
  }))();
  pubCache.set(k, p);
  try { return await p; } catch (e) { pubCache.delete(k); throw new CryptoError('bad-public-key'); }
}

async function sha256(bytes) { return new Uint8Array(await subtle.digest('SHA-256', bytes)); }
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// Отпечаток публичных ключей (стабилен, пока ключи не меняются).
export async function fingerprint(pub) {
  return hex(await sha256(te.encode(PROTO + '|fp|' + pub.dh + '|' + pub.sig)));
}

// Код безопасности пары: 60 цифр (12 групп по 5), одинаков у обоих собеседников.
export async function safetyNumber(fpA, fpB) {
  const [a, b] = [fpA, fpB].sort();
  const h = new Uint8Array(await subtle.digest('SHA-512', te.encode(PROTO + '|safety|' + a + '|' + b)));
  const groups = [];
  for (let i = 0; i < 12; i++) {
    // 5 байт (40 бит) на группу → смещение от mod 100000 пренебрежимо
    let v = 0;
    for (let j = 0; j < 5; j++) v = v * 256 + h[i * 5 + j];
    groups.push(String(v % 100000).padStart(5, '0'));
  }
  return groups;
}

/* ── Код восстановления ─────────────────────────────────────────────────── */
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

export function newRecoveryCode() {
  const bytes = rnd(20); // 160 бит
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join('-'); // 32 символа, 8 групп
}

export function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s-]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  if (s.length !== 32 || [...s].some((c) => ALPHA.indexOf(c) === -1)) throw new CryptoError('bad-code-format');
  return s;
}

async function codeKey(code, salt, iter) {
  const base = await subtle.importKey('raw', te.encode(PROTO + '|backup|' + normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealBackup(priv, pub, uid, code) {
  const salt = rnd(16), iv = rnd(12);
  const key = await codeKey(code, salt, PBKDF2_ITER);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(uid) }, key,
    te.encode(JSON.stringify({ priv, pub })));
  return { v: 1, iter: PBKDF2_ITER, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

export async function openBackup(backup, uid, code) {
  const key = await codeKey(code, fromB64(backup.salt), backup.iter);
  let pt;
  try {
    pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(backup.iv), additionalData: te.encode(uid) }, key, fromB64(backup.ct));
  } catch (e) { throw new CryptoError('wrong-code'); }
  return JSON.parse(td.decode(pt));
}

/* ── Хранилище ключей на устройстве (IndexedDB) ─────────────────────────── */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('anthill', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('keys'); r.result.createObjectStore('pins'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}
export const deviceKeys = {
  save: (uid, keys) => tx('keys', 'readwrite', (s) => s.put(keys, uid)),
  load: (uid) => tx('keys', 'readonly', (s) => s.get(uid)),
  wipe: (uid) => tx('keys', 'readwrite', (s) => s.delete(uid))
};
// Закреплённые отпечатки собеседников (Trust On First Use).
export const pins = {
  get: (me, other) => tx('pins', 'readonly', (s) => s.get(me + ':' + other)),
  set: (me, other, pin) => tx('pins', 'readwrite', (s) => s.put(pin, me + ':' + other)),
  wipeAll: () => tx('pins', 'readwrite', (s) => s.clear())
};

/* ── Конверт сообщения ──────────────────────────────────────────────────── */
function signedBytes(env, chatId, msgId, sender) {
  const wraps = Object.keys(env.keys).sort().map((u) => [u, env.keys[u].i, env.keys[u].k]);
  return te.encode(JSON.stringify([PROTO, chatId, msgId, sender, env.epk, env.iv, env.ct, wraps]));
}

async function wrapKey(ephPriv, peerDh, chatId, msgId, uid, epkBytes) {
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peerDh }, ephPriv, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: await sha256(epkBytes), info: te.encode(PROTO + '|wrap|' + chatId + '|' + msgId + '|' + uid) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Зашифровать и подписать.
 * @param {object} p { data, chatId, msgId, sender, recipients: [{uid, pub:{dh CryptoKey}}], signKey }
 */
export async function seal(p) {
  const ck = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const ckRaw = await subtle.exportKey('raw', ck);
  const iv = rnd(12);
  const aad = te.encode(PROTO + '|' + p.chatId + '|' + p.msgId + '|' + p.sender);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, ck, te.encode(JSON.stringify(p.data)));

  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const epkBytes = new Uint8Array(await subtle.exportKey('spki', eph.publicKey));
  const keys = {};
  for (const r of p.recipients) {
    const wk = await wrapKey(eph.privateKey, r.pub.dh, p.chatId, p.msgId, r.uid, epkBytes);
    const wiv = rnd(12);
    keys[r.uid] = { i: toB64(wiv), k: toB64(await subtle.encrypt({ name: 'AES-GCM', iv: wiv }, wk, ckRaw)) };
  }
  const env = { v: 1, epk: toB64(epkBytes), iv: toB64(iv), ct: toB64(ct), keys };
  env.sig = toB64(await subtle.sign(SIGN, p.signKey, signedBytes(env, p.chatId, p.msgId, p.sender)));
  return env;
}

/**
 * Проверить подпись и расшифровать.
 * @param {object} p { env, chatId, msgId, sender, me, myDh, senderSig }
 */
export async function open(p) {
  const env = p.env;
  if (!env || env.v !== 1 || !env.keys || typeof env.sig !== 'string') throw new CryptoError('bad-envelope');
  const ok = await subtle.verify(SIGN, p.senderSig, fromB64(env.sig), signedBytes(env, p.chatId, p.msgId, p.sender));
  if (!ok) throw new CryptoError('bad-signature');
  const mine = env.keys[p.me];
  if (!mine) throw new CryptoError('not-for-me');
  const epkBytes = fromB64(env.epk);
  const epk = await subtle.importKey('spki', epkBytes, ECDH, false, []);
  const wk = await wrapKey(p.myDh, epk, p.chatId, p.msgId, p.me, epkBytes);
  let ckRaw;
  try { ckRaw = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(mine.i) }, wk, fromB64(mine.k)); }
  catch (e) { throw new CryptoError('cannot-unwrap'); }
  const ck = await subtle.importKey('raw', ckRaw, 'AES-GCM', false, ['decrypt']);
  const aad = te.encode(PROTO + '|' + p.chatId + '|' + p.msgId + '|' + p.sender);
  let pt;
  try { pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv), additionalData: aad }, ck, fromB64(env.ct)); }
  catch (e) { throw new CryptoError('cannot-decrypt'); }
  return JSON.parse(td.decode(pt));
}
