/* ==========================================================================
   Муравейник — приложение.
   Правила:
     • весь пользовательский контент — только textContent / проверенные data:image;
     • расшифрованный текст нигде не сохраняется (только в памяти вкладки);
     • картинки (аватары и фото) перекодируются через canvas → метаданные удаляются;
     • ключ собеседника закрепляется при первом контакте (TOFU), смена — предупреждение.
   ========================================================================== */
import * as C from './crypto.js';

const { el, icon } = window.EN;
const $ = (id) => document.getElementById(id);

if (!window.EN_FB) {
  $('scr-loading').querySelector('.status').textContent = 'Не удалось подключиться к серверу. Обновите страницу.';
  throw new Error('Firebase unavailable');
}
const auth = window.EN_FB.auth;
const db = window.EN_FB.db;
const FV = firebase.firestore.FieldValue;

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const IMG_RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_TEXT = 4000;

const S = {
  user: null, profile: null, keys: null,        // keys: { dh, sig, fp, pub }
  chats: new Map(), active: null,
  profiles: new Map(), blocked: new Set(),
  plain: new Map(),                             // msgId → расшифровка (только память)
  unsub: [], unsubMsgs: null, pendingImg: null
};

/* ── Экраны и утилиты ───────────────────────────────────────────────────── */
const SCREENS = ['loading', 'auth', 'setup', 'code', 'restore', 'app'];
function show(name) {
  SCREENS.forEach((s) => { $('scr-' + s).hidden = s !== name; });
}
function status(id, text, kind) {
  const n = $(id);
  n.textContent = text || '';
  n.className = 'status' + (kind ? ' is-' + kind : '');
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Подождите…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
function authError(e) {
  const c = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Неверная почта или пароль.';
  if (/too-many-requests/.test(c)) return 'Слишком много попыток. Подождите немного.';
  if (/weak-password/.test(c)) return 'Пароль слишком простой (минимум 8 символов).';
  if (/email-already-in-use/.test(c)) return 'Не удалось создать аккаунт с этой почтой.';
  if (/network/.test(c)) return 'Нет соединения.';
  if (/permission-denied/.test(c)) return 'Доступ запрещён.';
  return 'Ошибка: ' + (c || (e && e.message) || 'неизвестно');
}
const lsKey = (k) => 'ah:' + (S.user ? S.user.uid : '-') + ':' + k;
function lsGet(k, d) { try { const v = localStorage.getItem(lsKey(k)); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { /* приватный режим */ } }
const tsMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);

function avatar(profile, cls) {
  const box = el('span', { class: 'ava' + (cls ? ' ' + cls : '') });
  if (profile && typeof profile.avatar === 'string' && IMG_RE.test(profile.avatar)) {
    box.appendChild(el('img', { src: profile.avatar, alt: '' }));
  } else {
    box.textContent = profile && profile.handle ? profile.handle[0] : '?';
  }
  return box;
}
function groupAvatar(name) { return el('span', { class: 'ava ava--group', text: (name || '#')[0] }); }

/* ── Модальные окна ─────────────────────────────────────────────────────── */
const modal = $('ah-modal');
const modalBody = $('ah-modal-body');
function openModal(nodes) {
  modalBody.textContent = '';
  nodes.forEach((n) => n && modalBody.appendChild(n));
  if (!modal.open) modal.showModal();
}
function closeModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

function confirmBox(title, text, okLabel, danger) {
  return new Promise((resolve) => {
    const ok = el('button', { class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'), type: 'button', text: okLabel || 'OK' });
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Отмена' });
    const done = (v) => { modal.removeEventListener('close', onClose); closeModal(); resolve(v); };
    const onClose = () => resolve(false);
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    modal.addEventListener('close', onClose, { once: true });
    openModal([el('h2', { text: title }), el('p', { class: 'muted', text: text }), el('div', { class: 'btn-row' }, [cancel, ok])]);
  });
}
function promptBox(title, text, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const input = el('input', { class: 'input' + (opts.mono ? ' mono' : ''), type: opts.type || 'text', autocomplete: 'off', spellcheck: 'false', placeholder: opts.placeholder || '' });
    const ok = el('button', { class: 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary'), type: 'submit', text: opts.ok || 'OK' });
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Отмена' });
    const form = el('form', { class: 'stack', novalidate: true }, [el('h2', { text: title }), text ? el('p', { class: 'muted', text: text }) : null, input, el('div', { class: 'btn-row' }, [cancel, ok])]);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; closeModal(); resolve(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(input.value); });
    cancel.addEventListener('click', () => done(null));
    modal.addEventListener('close', () => done(null), { once: true });
    openModal([form]);
    setTimeout(() => input.focus(), 50);
  });
}

/* ── Картинки: перекодирование через canvas (вырезает EXIF/GPS) ─────────── */
async function reencode(file, maxSide, quality, square) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Это не картинка.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ.');
  const bmp = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * scale));
  cv.height = Math.max(1, Math.round(sh * scale));
  cv.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  bmp.close();
  // Safari не кодирует WebP — тогда JPEG. В обоих случаях метаданных нет.
  const webp = cv.toDataURL('image/webp', quality);
  return webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/jpeg', quality);
}
async function makeAvatar(file) {
  for (const q of [0.85, 0.7, 0.5]) {
    const url = await reencode(file, 128, q, true);
    if (url.length <= 60000) return url;
  }
  throw new Error('Не удалось сжать аватар.');
}
async function makePhoto(file) {
  for (const [side, q] of [[1600, 0.82], [1280, 0.72], [960, 0.65], [720, 0.55]]) {
    const url = await reencode(file, side, q, false);
    if (url.length <= 500000) return url;
  }
  throw new Error('Картинка слишком большая даже после сжатия.');
}

/* ── Маршрутизация по состоянию аккаунта ────────────────────────────────── */
function stopListeners() {
  S.unsub.forEach((u) => u());
  S.unsub = [];
  if (S.unsubMsgs) { S.unsubMsgs(); S.unsubMsgs = null; }
}

auth.onAuthStateChanged((user) => { route(user).catch((e) => { console.error(e); show('auth'); status('auth-status', authError(e), 'err'); }); });

async function route(user) {
  stopListeners();
  S.user = user; S.profile = null; S.keys = null;
  S.chats.clear(); S.profiles.clear(); S.plain.clear(); S.active = null;
  if (!user || user.isAnonymous) { show('auth'); return; }
  show('loading');
  const snap = await db.collection('profiles').doc(user.uid).get();
  if (!snap.exists) { show('setup'); return; }
  S.profile = snap.data();
  const keys = await C.deviceKeys.load(user.uid);
  if (!keys || keys.fp !== S.profile.fp) { show('restore'); return; }
  S.keys = keys;
  await startApp();
}

document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', () => auth.signOut()));

/* ── Вход / регистрация ─────────────────────────────────────────────────── */
let mode = 'login';
function setMode(m) {
  mode = m;
  $('tab-login').setAttribute('aria-selected', String(m === 'login'));
  $('tab-register').setAttribute('aria-selected', String(m === 'register'));
  $('auth-pass2-wrap').hidden = m !== 'register';
  $('auth-note').hidden = m !== 'register';
  $('auth-reset').hidden = m !== 'login';
  $('auth-pass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('auth-submit').textContent = m === 'register' ? 'Создать аккаунт' : 'Войти';
  status('auth-status', '');
}
$('tab-login').addEventListener('click', () => setMode('login'));
$('tab-register').addEventListener('click', () => setMode('register'));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const pass = $('auth-pass').value;
  if (!email || !pass) { status('auth-status', 'Заполните почту и пароль.', 'err'); return; }
  const btn = $('auth-submit');
  try {
    if (mode === 'register') {
      if (pass.length < 8) { status('auth-status', 'Пароль — минимум 8 символов.', 'err'); return; }
      if (pass !== $('auth-pass2').value) { status('auth-status', 'Пароли не совпадают.', 'err'); return; }
      busy(btn, true);
      await auth.createUserWithEmailAndPassword(email, pass);
    } else {
      busy(btn, true);
      await auth.signInWithEmailAndPassword(email, pass);
    }
    $('auth-pass').value = ''; $('auth-pass2').value = '';
  } catch (err) {
    status('auth-status', authError(err), 'err');
  } finally { busy(btn, false); }
});

$('auth-reset').addEventListener('click', async () => {
  const email = $('auth-email').value.trim();
  if (!email) { status('auth-status', 'Введите почту, на которую прислать ссылку.', 'err'); return; }
  try { await auth.sendPasswordResetEmail(email); } catch (e) { /* не раскрываем, есть ли такой аккаунт */ }
  status('auth-status', 'Если такой аккаунт есть, письмо со ссылкой уже в пути.', 'ok');
});

/* ── Профиль (шаг 2) ────────────────────────────────────────────────────── */
let setupAvatar = null;
$('setup-avatar').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    setupAvatar = await makeAvatar(f);
    const box = $('setup-ava');
    box.textContent = '';
    box.appendChild(el('img', { src: setupAvatar, alt: '' }));
    status('setup-status', '');
  } catch (err) { status('setup-status', err.message, 'err'); }
  e.target.value = '';
});

let pending = null; // { handle, bio, avatar, ident, code, reset }
$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const handle = $('setup-handle').value.trim().replace(/^@/, '').toLowerCase();
  const bio = $('setup-bio').value.trim().slice(0, 280);
  if (!HANDLE_RE.test(handle)) { status('setup-status', 'Ник: 3–20 символов, только a–z, 0–9 и _.', 'err'); return; }
  status('setup-status', 'Проверяю ник…');
  try {
    const h = await db.collection('handles').doc(handle).get();
    if (h.exists) { status('setup-status', 'Этот ник уже занят.', 'err'); return; }
  } catch (err) { status('setup-status', authError(err), 'err'); return; }
  status('setup-status', 'Генерирую ключи шифрования…');
  pending = { handle, bio, avatar: setupAvatar, ident: await C.generateIdentity(), code: C.newRecoveryCode(), reset: false };
  showCode();
});

/* ── Код восстановления (шаг 3, а также смена ключей) ───────────────────── */
function showCode() {
  $('code-value').textContent = pending.code;
  $('code-step').textContent = pending.reset ? 'Новые ключи' : 'Шаг 2 из 2';
  $('code-saved').checked = false;
  $('code-confirm').value = '';
  status('code-status', '');
  show('code');
}
$('code-download').addEventListener('click', () => {
  const text = 'Муравейник (EgorNetwork) — код восстановления\n\n' + pending.code +
    '\n\nХраните в надёжном месте. Любой, у кого есть этот код и доступ к вашему аккаунту, прочитает вашу переписку.\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = el('a', { href: url, download: 'anthill-recovery-code.txt' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pending) return;
  const tail = pending.code.replace(/-/g, '').slice(-4);
  if (!$('code-saved').checked) { status('code-status', 'Подтвердите, что сохранили код.', 'err'); return; }
  if ($('code-confirm').value.trim().toUpperCase() !== tail) { status('code-status', 'Последние 4 символа не совпадают.', 'err'); return; }
  const btn = $('code-submit');
  busy(btn, true, 'Шифрую и сохраняю…');
  try {
    const uid = S.user.uid;
    const { pub, priv } = pending.ident;
    const fp = await C.fingerprint(pub);
    const backup = await C.sealBackup(priv, pub, uid, pending.code);
    const batch = db.batch();
    if (pending.reset) {
      batch.update(db.collection('profiles').doc(uid), { pub, fp, keyVer: (S.profile.keyVer || 1) + 1, updatedAt: FV.serverTimestamp() });
    } else {
      batch.set(db.collection('handles').doc(pending.handle), { uid });
      batch.set(db.collection('profiles').doc(uid), {
        handle: pending.handle, bio: pending.bio, avatar: pending.avatar || null, pub, fp, keyVer: 1,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
      });
    }
    batch.set(db.collection('keybackups').doc(uid), Object.assign({}, backup, { updatedAt: FV.serverTimestamp() }));
    await batch.commit();
    const keys = await C.importPrivate(priv);
    await C.deviceKeys.save(uid, { dh: keys.dh, sig: keys.sig, fp, pub });
    pending = null; // приватные ключи больше нигде не лежат в открытом виде
    route(S.user);
  } catch (err) {
    status('code-status', /permission-denied/.test(err.code || '') && !pending.reset ? 'Ник только что заняли — вернитесь и выберите другой.' : authError(err), 'err');
    if (!pending.reset) setTimeout(() => show('setup'), 1800);
  } finally { busy(btn, false); }
});

/* ── Восстановление ключей ──────────────────────────────────────────────── */
$('restore-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('restore-code').value;
  try { C.normalizeCode(code); } catch (err) { status('restore-status', 'Код — 32 символа (дефисы и пробелы не важны).', 'err'); return; }
  status('restore-status', 'Проверяю код…');
  try {
    const uid = S.user.uid;
    const b = await db.collection('keybackups').doc(uid).get();
    if (!b.exists) { status('restore-status', 'Бэкап ключей не найден. Создайте новые ключи.', 'err'); return; }
    const { priv, pub } = await C.openBackup(b.data(), uid, code);
    const fp = await C.fingerprint(pub);
    if (fp !== S.profile.fp) { status('restore-status', 'Код от старых ключей: профиль уже использует другие.', 'err'); return; }
    const keys = await C.importPrivate(priv);
    await C.deviceKeys.save(uid, { dh: keys.dh, sig: keys.sig, fp, pub });
    $('restore-code').value = '';
    route(S.user);
  } catch (err) {
    status('restore-status', err.code === 'wrong-code' ? 'Неверный код.' : authError(err), 'err');
  }
});

$('restore-reset').addEventListener('click', async () => {
  const typed = await promptBox('Создать новые ключи?',
    'Вся старая переписка станет нечитаемой на всех устройствах, а собеседники увидят, что ваш ключ сменился. Введите свой ник, чтобы подтвердить.',
    { placeholder: S.profile.handle, danger: true, ok: 'Создать новые ключи' });
  if (typed === null) return;
  if (typed.trim().replace(/^@/, '').toLowerCase() !== S.profile.handle) { status('restore-status', 'Ник не совпал — ничего не изменено.', 'err'); return; }
  pending = { ident: await C.generateIdentity(), code: C.newRecoveryCode(), reset: true };
  showCode();
});

/* ── Профили собеседников и закрепление ключей ──────────────────────────── */
async function getPeer(uid, fresh) {
  if (!fresh && S.profiles.has(uid)) return S.profiles.get(uid);
  const snap = await db.collection('profiles').doc(uid).get();
  if (!snap.exists) {
    const gone = { uid, deleted: true, profile: { handle: 'удалённый' }, state: 'deleted' };
    S.profiles.set(uid, gone);
    return gone;
  }
  const profile = snap.data();
  let keys = null;
  try { keys = await C.importPublic(profile.pub); } catch (e) { /* битые ключи */ }
  const fp = await C.fingerprint(profile.pub);
  let state = 'self';
  if (uid !== S.user.uid) {
    const pin = await C.pins.get(S.user.uid, uid);
    if (!pin) { await C.pins.set(S.user.uid, uid, { fp, verified: false }); state = 'new'; }
    else if (pin.fp !== fp) state = 'changed';
    else state = pin.verified ? 'verified' : 'new';
  }
  const peer = { uid, profile, keys, fp, state };
  S.profiles.set(uid, peer);
  return peer;
}
async function acceptKey(peer, verified) {
  await C.pins.set(S.user.uid, peer.uid, { fp: peer.fp, verified: !!verified });
  peer.state = verified ? 'verified' : 'new';
  S.plain.clear();
  if (S.active) renderChat();
  renderList();
}

/* ── Запуск приложения ──────────────────────────────────────────────────── */
let chatsReady = null;
async function startApp() {
  // свой публичный ключ нужен до первого сообщения (шифруем и себе, проверяем свои подписи)
  const myPub = await C.importPublic(S.profile.pub);
  show('app');
  const me = S.profile;
  const ava = $('me-ava');
  ava.replaceWith(Object.assign(avatar(me), { id: 'me-ava' }));
  $('me-handle').textContent = '@' + me.handle;
  S.profiles.set(S.user.uid, { uid: S.user.uid, profile: me, keys: myPub, fp: me.fp, state: 'self' });
  let markReady;
  chatsReady = new Promise((r) => { markReady = r; });

  S.unsub.push(db.collection('users').doc(S.user.uid).collection('blocked').onSnapshot((snap) => {
    S.blocked = new Set(snap.docs.map((d) => d.id));
    if (S.active) renderChat();
  }, () => {}));

  S.unsub.push(db.collection('chats').where('members', 'array-contains', S.user.uid).limit(200)
    .onSnapshot({ includeMetadataChanges: false }, (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') S.chats.delete(ch.doc.id);
        else S.chats.set(ch.doc.id, Object.assign({ id: ch.doc.id }, ch.doc.data({ serverTimestamps: 'estimate' })));
      });
      markReady();
      if (S.active && !S.chats.has(S.active)) closeChat();
      renderList();
      if (S.active) renderHead();
    }, (e) => { console.error(e); $('chat-list').textContent = ''; $('chat-list').appendChild(el('p', { class: 'ah-empty', text: 'Не удалось загрузить чаты.' })); }));
}

/* ── Список чатов ───────────────────────────────────────────────────────── */
const titles = new Map(); // chatId → { title, ava }
async function chatTitle(chat) {
  if (chat.type === 'dm') {
    const peerUid = chat.members.find((u) => u !== S.user.uid);
    const peer = await getPeer(peerUid);
    return { title: '@' + peer.profile.handle, ava: avatar(peer.profile), peer };
  }
  const cacheKey = chat.id + '|' + (chat.meta && chat.meta.sig);
  if (titles.has(cacheKey)) return titles.get(cacheKey);
  let name = 'Группа';
  try {
    const signer = await getPeer(chat.metaBy);
    const meta = await C.open({ env: chat.meta, chatId: chat.id, msgId: 'meta', sender: chat.metaBy, me: S.user.uid, myDh: S.keys.dh, senderSig: signer.keys.sig });
    if (typeof meta.name === 'string') name = meta.name.slice(0, 60);
  } catch (e) { name = 'Группа (не расшифровать)'; }
  const t = { title: name, ava: null };
  titles.set(cacheKey, t);
  return t;
}

let listGen = 0;
async function renderList() {
  const gen = ++listGen;
  const chats = Array.from(S.chats.values()).sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt));
  const read = lsGet('read', {});
  const rows = [];
  for (const chat of chats) {
    let t;
    try { t = await chatTitle(chat); } catch (e) { t = { title: '…' }; }
    if (gen !== listGen) return; // пришёл более свежий снапшот
    const unread = chat.id !== S.active && tsMs(chat.updatedAt) > (read[chat.id] || 0) && tsMs(chat.updatedAt) > tsMs(chat.createdAt) + 1;
    const btn = el('button', {
      class: 'ah-item' + (unread ? ' is-unread' : ''), type: 'button', role: 'listitem',
      'aria-current': chat.id === S.active ? 'true' : null
    }, [
      chat.type === 'group' ? groupAvatar(t.title) : (t.ava || avatar(null)),
      el('span', { class: 'ah-item__body' }, [
        el('span', { class: 'ah-item__title', text: t.title }),
        el('span', { class: 'ah-item__sub', text: chat.type === 'group' ? chat.members.length + ' участн. · 🔒' : (t.peer && t.peer.state === 'changed' ? '⚠ ключ сменился' : '🔒 личный чат') })
      ])
    ]);
    btn.addEventListener('click', () => openChat(chat.id));
    rows.push(btn);
  }
  const list = $('chat-list');
  list.textContent = '';
  if (!rows.length) list.appendChild(el('p', { class: 'ah-empty', text: 'Чатов пока нет. Найдите собеседника по @нику или создайте группу.' }));
  rows.forEach((r) => list.appendChild(r));
  const unreadCount = rows.filter((r) => r.classList.contains('is-unread')).length;
  document.title = (unreadCount ? '(' + unreadCount + ') ' : '') + 'Муравейник — EgorNetwork';
}

/* ── Поиск по точному нику ──────────────────────────────────────────────── */
$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const handle = $('search-input').value.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) { flash('Ник: 3–20 символов, a–z, 0–9, _'); return; }
  try {
    const h = await db.collection('handles').doc(handle).get();
    if (!h.exists) { flash('Никого с ником @' + handle + ' нет.'); return; }
    $('search-input').value = '';
    showProfile(h.data().uid);
  } catch (err) { flash(authError(err)); }
});
function flash(text) {
  openModal([el('p', { text }), el('div', { class: 'btn-row' }, [Object.assign(el('button', { class: 'btn', type: 'button', text: 'OK' }), { onclick: closeModal })])]);
}

/* ── Профиль собеседника ────────────────────────────────────────────────── */
async function showProfile(uid) {
  if (uid === S.user.uid) { showMe(); return; }
  const peer = await getPeer(uid, true);
  if (peer.deleted) { flash('Аккаунт удалён.'); return; }
  const safety = await C.safetyNumber(S.profile.fp, peer.fp);
  const blocked = S.blocked.has(uid);
  const write = el('button', { class: 'btn btn--primary', type: 'button', text: 'Написать' });
  write.addEventListener('click', () => { closeModal(); openDm(uid); });
  const block = el('button', { class: 'btn ' + (blocked ? '' : 'btn--danger'), type: 'button', text: blocked ? 'Разблокировать' : 'Заблокировать' });
  block.addEventListener('click', async () => {
    const ref = db.collection('users').doc(S.user.uid).collection('blocked').doc(uid);
    try { blocked ? await ref.delete() : await ref.set({ at: FV.serverTimestamp() }); closeModal(); }
    catch (err) { flash(authError(err)); }
  });
  const stateText = {
    verified: '✓ Ключ проверен вами лично',
    new: 'Ключ не проверен. Сверьте код ниже с собеседником по другому каналу (лично, по видео).',
    changed: '⚠ Ключ собеседника изменился с прошлого раза! Это нормально, если он потерял код восстановления, — или признак подмены. Сверьте код.'
  }[peer.state];
  const verifyBtn = el('button', { class: 'btn btn--sm', type: 'button', text: peer.state === 'changed' ? 'Принять новый ключ' : 'Коды совпали — отметить проверенным' });
  verifyBtn.addEventListener('click', async () => { await acceptKey(peer, peer.state !== 'changed'); closeModal(); });

  openModal([
    el('div', { class: 'ah-profile' }, [
      avatar(peer.profile, 'ava--lg'),
      el('h2', { text: '@' + peer.profile.handle }),
      peer.profile.bio ? el('p', { class: 'bio', text: peer.profile.bio }) : null
    ]),
    el('p', { class: peer.state === 'changed' ? 'ah-danger' : (peer.state === 'verified' ? 'accent' : 'muted'), text: stateText }),
    el('div', { class: 'ah-safety', 'aria-label': 'Код безопасности' }, safety.map((g) => el('span', { text: g }))),
    peer.state !== 'verified' ? el('div', { class: 'btn-row' }, [verifyBtn]) : null,
    el('div', { class: 'btn-row' }, [block, write])
  ]);
}

/* ── Личные чаты ────────────────────────────────────────────────────────── */
async function openDm(uid) {
  if (chatsReady) await chatsReady;
  const existing = Array.from(S.chats.values()).find((c) => c.type === 'dm' && c.members.indexOf(uid) !== -1);
  if (existing) { openChat(existing.id); return; }
  try {
    const ref = db.collection('chats').doc();
    await ref.set({ type: 'dm', members: [S.user.uid, uid], createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
    S.chats.set(ref.id, { id: ref.id, type: 'dm', members: [S.user.uid, uid], createdAt: null, updatedAt: null });
    openChat(ref.id);
  } catch (err) {
    flash(/permission-denied/.test(err.code || '') ? 'Не удалось начать чат: пользователь недоступен.' : authError(err));
  }
}

/* ── Открытый чат ───────────────────────────────────────────────────────── */
const pane = $('chat-pane');
let headEl = null, bannerEl = null, msgsEl = null, attachEl = null, textEl = null;

function markRead(id) { const r = lsGet('read', {}); r[id] = Date.now() + 1000; lsSet('read', r); }

function closeChat() {
  if (S.unsubMsgs) { S.unsubMsgs(); S.unsubMsgs = null; }
  S.active = null;
  $('scr-app').classList.remove('is-chat');
  pane.textContent = '';
  pane.appendChild(el('div', { class: 'ah-placeholder' }, [icon('lock'), el('p', { text: 'Выберите чат слева или найдите собеседника по точному @нику.' })]));
  renderList();
}

function openChat(id) {
  if (S.unsubMsgs) { S.unsubMsgs(); S.unsubMsgs = null; }
  S.active = id;
  S.pendingImg = null;
  markRead(id);
  $('scr-app').classList.add('is-chat');

  headEl = el('div', { class: 'ah-chat__head' });
  bannerEl = el('div');
  msgsEl = el('div', { class: 'ah-msgs', role: 'log' }, el('p', { class: 'ah-placeholder', text: 'Загрузка…' }));
  attachEl = el('div');
  textEl = el('textarea', { class: 'textarea', rows: '1', maxlength: String(MAX_TEXT), placeholder: 'Сообщение (шифруется)…', 'aria-label': 'Сообщение' });
  const file = el('input', { type: 'file', accept: 'image/*' });
  const clip = el('button', { class: 'ah-icon-btn', type: 'button', title: 'Фото', 'aria-label': 'Прикрепить фото' }, icon('clip'));
  const sendBtn = el('button', { class: 'ah-icon-btn', type: 'submit', title: 'Отправить', 'aria-label': 'Отправить' }, icon('send'));
  const form = el('form', { class: 'ah-compose', autocomplete: 'off' }, [file, clip, textEl, sendBtn]);

  clip.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    try { S.pendingImg = await makePhoto(f); renderAttach(); } catch (err) { flash(err.message); }
  });
  textEl.addEventListener('input', () => { textEl.style.height = 'auto'; textEl.style.height = Math.min(180, textEl.scrollHeight) + 'px'; });
  textEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(sendBtn); });

  pane.textContent = '';
  [headEl, bannerEl, msgsEl, attachEl, form].forEach((n) => pane.appendChild(n));
  renderHead();
  renderList();

  S.unsubMsgs = db.collection('chats').doc(id).collection('messages').orderBy('createdAt', 'desc').limit(150)
    .onSnapshot((snap) => {
      if (S.active !== id) return;
      const docs = snap.docs.map((d) => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' }))).reverse();
      renderMessages(docs);
      markRead(id);
    }, (e) => { console.error(e); msgsEl.textContent = ''; msgsEl.appendChild(el('p', { class: 'ah-placeholder', text: 'Нет доступа к сообщениям.' })); });
  setTimeout(() => textEl.focus(), 50);
}

function renderAttach() {
  attachEl.textContent = '';
  if (!S.pendingImg) return;
  const rm = el('button', { class: 'ah-icon-btn', type: 'button', 'aria-label': 'Убрать фото' }, icon('close'));
  rm.addEventListener('click', () => { S.pendingImg = null; renderAttach(); });
  attachEl.appendChild(el('div', { class: 'ah-attach' }, [el('img', { src: S.pendingImg, alt: '' }), el('span', { text: 'Фото без метаданных, ' + Math.round(S.pendingImg.length / 1024 * 0.75) + ' КБ' }), rm]));
}

async function renderHead() {
  const chat = S.chats.get(S.active);
  if (!chat || !headEl) return;
  const t = await chatTitle(chat);
  const back = el('button', { class: 'ah-icon-btn ah-back', type: 'button', 'aria-label': 'Назад к чатам' }, icon('left'));
  back.addEventListener('click', closeChat);
  let sub, subCls = '';
  if (chat.type === 'dm') {
    const st = t.peer.state;
    sub = st === 'verified' ? '🔒 ключ проверен' : st === 'changed' ? '⚠ ключ собеседника изменился' : st === 'deleted' ? 'аккаунт удалён' : '🔒 шифрование · ключ не сверен';
    subCls = st === 'verified' ? 'ok' : st === 'changed' ? 'bad' : '';
  } else {
    sub = chat.members.length + ' участн. · 🔒 шифрование';
  }
  const title = el('button', { class: 'ah-chat__title', type: 'button' }, [el('b', { text: t.title }), el('small', { class: subCls, text: sub })]);
  title.addEventListener('click', () => (chat.type === 'dm' ? showProfile(t.peer.uid) : showGroup(chat.id)));
  headEl.textContent = '';
  [back, chat.type === 'group' ? groupAvatar(t.title) : t.ava, title].forEach((n) => headEl.appendChild(n));

  bannerEl.textContent = '';
  if (chat.type === 'dm' && t.peer.state === 'changed') {
    const check = el('button', { class: 'btn btn--sm', type: 'button', text: 'Сверить код' });
    check.addEventListener('click', () => showProfile(t.peer.uid));
    bannerEl.appendChild(el('div', { class: 'ah-banner ah-banner--bad' }, [el('span', { text: 'Ключ @' + t.peer.profile.handle + ' изменился. Отправка заблокирована, пока вы не сверите код безопасности.' }), check]));
  } else if (chat.type === 'dm' && S.blocked.has(t.peer.uid)) {
    bannerEl.appendChild(el('div', { class: 'ah-banner ah-banner--info' }, el('span', { text: 'Вы заблокировали этого пользователя.' })));
  }
}

function renderChat() { renderHead(); if (S.active && S.lastDocs) renderMessages(S.lastDocs); }

/* ── Сообщения ──────────────────────────────────────────────────────────── */
const ERR_TEXT = {
  'bad-signature': '⚠ Подпись не сошлась — сообщение могло быть подделано или отправлено со старого ключа.',
  'not-for-me': '🔒 Сообщение отправлено до того, как вы получили доступ, или вашему старому ключу.',
  'cannot-unwrap': '🔒 Не расшифровать: сообщение для вашего старого ключа.',
  'cannot-decrypt': '⚠ Повреждённое сообщение.',
  'bad-envelope': '⚠ Повреждённое сообщение.',
  'no-key': '🔒 Не удалось проверить отправителя.',
  'old-key': '🔒 Отправлено со старого ключа отправителя — содержимое скрыто, проверить подпись нельзя.'
};

const refetched = new Set();
async function decryptMsg(chatId, m) {
  // Кэш привязан к конверту целиком: если в базе поменяли хоть байт — расшифровываем заново.
  const env = m.env || {};
  const fingerprintOf = m.sender + '|' + env.sig + '|' + env.epk + '|' + env.iv + '|' + env.ct + '|' + JSON.stringify(env.keys || {});
  const cached = S.plain.get(m.id);
  if (cached && cached.src === fingerprintOf) return cached.res;
  let res;
  const attempt = async (fresh) => {
    const sender = await getPeer(m.sender, fresh);
    if (!sender.keys) throw new C.CryptoError('no-key');
    return C.open({ env: m.env, chatId, msgId: m.id, sender: m.sender, me: S.user.uid, myDh: S.keys.dh, senderSig: sender.keys.sig });
  };
  try {
    let data;
    try { data = await attempt(false); }
    catch (e) {
      // собеседник мог сменить ключи, пока чат открыт — перечитываем профиль один раз
      if (e.code !== 'bad-signature' || m.sender === S.user.uid || refetched.has(m.sender)) throw e;
      refetched.add(m.sender);
      data = await attempt(true);
      renderHead(); renderList();
    }
    res = { ok: true, text: typeof data.t === 'string' ? data.t.slice(0, MAX_TEXT) : '', img: typeof data.img === 'string' && IMG_RE.test(data.img) ? data.img : null };
  } catch (e) {
    res = { ok: false, err: (e && e.code) || 'cannot-decrypt' };
    // Отправитель менял ключи — старые сообщения честно помечаем, а не «подделкой».
    const sp = S.profiles.get(m.sender);
    if (res.err === 'bad-signature' && sp && sp.profile && sp.profile.keyVer > 1) res.err = 'old-key';
  }
  S.plain.set(m.id, { src: fingerprintOf, res });
  return res;
}

// Текст → узлы; http(s)-ссылки кликабельны, остальное — просто текст.
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<>"']+/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    let url = m[0].replace(/[.,!?;:)]+$/, '');
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') frag.appendChild(el('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer nofollow', text: url }));
      else frag.appendChild(document.createTextNode(url));
    } catch (e) { frag.appendChild(document.createTextNode(url)); }
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

let msgGen = 0;
async function renderMessages(docs) {
  S.lastDocs = docs;
  const gen = ++msgGen;
  const chatId = S.active;
  const chat = S.chats.get(chatId);
  if (!chat) return;
  const isAdmin = chat.type === 'group' && (chat.admins || []).indexOf(S.user.uid) !== -1;
  const nodes = [];
  let lastDay = '';
  for (const m of docs) {
    if (S.blocked.has(m.sender)) continue;
    const res = await decryptMsg(chatId, m);
    if (gen !== msgGen || S.active !== chatId) return;
    const ms = tsMs(m.createdAt) || Date.now();
    const day = fmtDay(ms);
    if (day !== lastDay) { nodes.push(el('div', { class: 'day-sep', text: day })); lastDay = day; }
    const mine = m.sender === S.user.uid;
    const bubble = el('div', { class: 'msg__bubble' });
    if (chat.type === 'group' && !mine) {
      const who = await getPeer(m.sender);
      const from = el('button', { class: 'msg__from', type: 'button', text: '@' + who.profile.handle });
      from.addEventListener('click', () => showProfile(m.sender));
      bubble.appendChild(from);
    }
    if (res.ok) {
      if (res.img) {
        const img = el('img', { class: 'msg__img', src: res.img, alt: 'Фото', loading: 'lazy' });
        img.addEventListener('click', () => { $('ah-img-el').src = res.img; $('ah-img').showModal(); });
        bubble.appendChild(img);
      }
      if (res.text) bubble.appendChild(el('div', { class: 'msg__text' }, linkify(res.text)));
    } else {
      bubble.appendChild(el('div', { text: ERR_TEXT[res.err] || ERR_TEXT['cannot-decrypt'] }));
    }
    const meta = el('div', { class: 'msg__meta' }, [el('span', { text: fmtTime(ms) })]);
    if (mine || isAdmin) {
      const del = el('button', { class: 'msg__del', type: 'button', title: 'Удалить', 'aria-label': 'Удалить сообщение' }, '✕');
      del.addEventListener('click', async () => {
        if (!(await confirmBox('Удалить сообщение?', 'Оно исчезнет у всех участников.', 'Удалить', true))) return;
        db.collection('chats').doc(chatId).collection('messages').doc(m.id).delete().catch((err) => flash(authError(err)));
      });
      meta.appendChild(del);
    }
    bubble.appendChild(meta);
    nodes.push(el('div', { class: 'msg' + (mine ? ' is-mine' : '') + (res.ok ? '' : ' msg--err') }, bubble));
  }
  const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
  msgsEl.textContent = '';
  if (!nodes.length) msgsEl.appendChild(el('div', { class: 'ah-placeholder' }, [icon('lock'), el('p', { text: 'Сообщения шифруются на вашем устройстве. Напишите первым.' })]));
  nodes.forEach((n) => msgsEl.appendChild(n));
  if (atBottom || nodes.length < 30) msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function recipientsFor(chat) {
  const out = [];
  for (const uid of chat.members) {
    const p = await getPeer(uid);
    if (p.deleted || !p.keys) continue;
    out.push(p);
  }
  return out;
}

async function sendMessage(btn) {
  const chat = S.chats.get(S.active);
  if (!chat) return;
  const text = textEl.value.trim();
  const img = S.pendingImg;
  if (!text && !img) return;
  if (text.length > MAX_TEXT) { flash('Слишком длинное сообщение (максимум ' + MAX_TEXT + ' символов).'); return; }
  btn.disabled = true;
  try {
    const peers = await recipientsFor(chat);
    const changed = peers.filter((p) => p.state === 'changed');
    if (changed.length) {
      if (chat.type === 'dm') { flash('Ключ собеседника изменился. Сверьте код безопасности в профиле, прежде чем писать.'); return; }
      const ok = await confirmBox('Ключи изменились', 'У ' + changed.map((p) => '@' + p.profile.handle).join(', ') + ' сменились ключи шифрования. Отправить всё равно?', 'Отправить');
      if (!ok) return;
    }
    if (chat.type === 'dm' && peers.length < 2) { flash('Собеседник удалил аккаунт.'); return; }
    const ref = db.collection('chats').doc(chat.id).collection('messages').doc();
    const data = { t: text };
    if (img) data.img = img;
    const env = await C.seal({
      data, chatId: chat.id, msgId: ref.id, sender: S.user.uid,
      recipients: peers.map((p) => ({ uid: p.uid, pub: p.keys })), signKey: S.keys.sig
    });
    const batch = db.batch();
    batch.set(ref, { sender: S.user.uid, createdAt: FV.serverTimestamp(), env });
    batch.update(db.collection('chats').doc(chat.id), { updatedAt: FV.serverTimestamp() });
    textEl.value = ''; textEl.style.height = 'auto';
    S.pendingImg = null; renderAttach();
    await batch.commit();
    markRead(chat.id);
  } catch (err) {
    flash(/permission-denied/.test(err.code || '') ? 'Не удалось отправить: нет доступа (возможно, вас заблокировали или исключили).' : authError(err));
  } finally { btn.disabled = false; textEl.focus(); }
}

/* ── Группы ─────────────────────────────────────────────────────────────── */
async function sealMeta(chatId, members, name) {
  const peers = [];
  for (const uid of members) { const p = await getPeer(uid); if (p.keys) peers.push({ uid, pub: p.keys }); }
  return C.seal({ data: { name }, chatId, msgId: 'meta', sender: S.user.uid, recipients: peers, signKey: S.keys.sig });
}

async function resolveHandle(raw) {
  const handle = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) throw new Error('Неверный ник: @' + handle);
  const h = await db.collection('handles').doc(handle).get();
  if (!h.exists) throw new Error('Нет пользователя @' + handle);
  return { uid: h.data().uid, handle };
}

function memberPicker(initial) {
  const picked = new Map(initial || []);
  const chips = el('div', { class: 'ah-chips' });
  const input = el('input', { class: 'input', placeholder: '@ник участника', spellcheck: 'false', maxlength: '21', 'aria-label': 'Добавить участника' });
  const add = el('button', { class: 'btn btn--sm', type: 'button', text: 'Добавить' });
  const err = el('p', { class: 'status' });
  function draw() {
    chips.textContent = '';
    picked.forEach((handle, uid) => {
      const rm = el('button', { type: 'button', 'aria-label': 'Убрать @' + handle }, icon('close'));
      rm.addEventListener('click', () => { picked.delete(uid); draw(); });
      chips.appendChild(el('span', { class: 'ah-chip' }, ['@' + handle, rm]));
    });
  }
  async function doAdd() {
    err.textContent = '';
    try {
      const r = await resolveHandle(input.value);
      if (r.uid === S.user.uid) throw new Error('Себя добавлять не нужно.');
      if (picked.size >= 49) throw new Error('Максимум 50 участников.');
      picked.set(r.uid, r.handle); input.value = ''; draw();
    } catch (e) { err.textContent = e.message; err.className = 'status is-err'; }
  }
  add.addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  draw();
  return { node: el('div', { class: 'stack' }, [el('div', { class: 'btn-row' }, [input, add]), chips, err]), picked };
}

$('btn-new-group').addEventListener('click', () => {
  const name = el('input', { class: 'input', maxlength: '60', placeholder: 'Название группы', 'aria-label': 'Название группы' });
  const picker = memberPicker();
  const create = el('button', { class: 'btn btn--primary', type: 'button', text: 'Создать' });
  const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Отмена' });
  const st = el('p', { class: 'status' });
  cancel.addEventListener('click', closeModal);
  create.addEventListener('click', async () => {
    const n = name.value.trim();
    if (!n) { st.textContent = 'Введите название.'; st.className = 'status is-err'; return; }
    if (!picker.picked.size) { st.textContent = 'Добавьте хотя бы одного участника.'; st.className = 'status is-err'; return; }
    busy(create, true);
    try {
      const members = [S.user.uid].concat(Array.from(picker.picked.keys()));
      const ref = db.collection('chats').doc();
      const meta = await sealMeta(ref.id, members, n);
      await ref.set({ type: 'group', members, admins: [S.user.uid], meta, metaBy: S.user.uid, createdBy: S.user.uid, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
      closeModal();
      S.chats.set(ref.id, { id: ref.id, type: 'group', members, admins: [S.user.uid], meta, metaBy: S.user.uid, createdAt: null, updatedAt: null });
      openChat(ref.id);
    } catch (err) { st.textContent = authError(err); st.className = 'status is-err'; }
    finally { busy(create, false); }
  });
  openModal([el('h2', { text: 'Новая группа' }), el('p', { class: 'hint', text: 'Название группы тоже шифруется — сервер его не видит.' }), name, picker.node, st, el('div', { class: 'btn-row' }, [cancel, create])]);
  setTimeout(() => name.focus(), 50);
});

async function showGroup(chatId) {
  const chat = S.chats.get(chatId);
  if (!chat) return;
  const t = await chatTitle(chat);
  const isAdmin = (chat.admins || []).indexOf(S.user.uid) !== -1;
  const ref = db.collection('chats').doc(chatId);
  const st = el('p', { class: 'status' });
  const fail = (err) => { st.textContent = err.message && !err.code ? err.message : authError(err); st.className = 'status is-err'; };

  const list = el('div', { class: 'ah-members' });
  for (const uid of chat.members) {
    const p = await getPeer(uid);
    const row = el('div', { class: 'ah-member' }, [avatar(p.profile, 'ava--sm'), el('span', { text: '@' + p.profile.handle + (uid === S.user.uid ? ' (вы)' : '') }), (chat.admins || []).indexOf(uid) !== -1 ? el('em', { text: 'админ' }) : null]);
    if (uid !== S.user.uid) {
      const info = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Профиль' });
      info.addEventListener('click', () => showProfile(uid));
      row.appendChild(info);
    }
    if (isAdmin && uid !== S.user.uid) {
      const mk = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: (chat.admins || []).indexOf(uid) !== -1 ? 'Снять админа' : 'Сделать админом' });
      mk.addEventListener('click', async () => {
        const isA = (chat.admins || []).indexOf(uid) !== -1;
        try { await ref.update({ admins: isA ? FV.arrayRemove(uid) : FV.arrayUnion(uid), updatedAt: FV.serverTimestamp() }); closeModal(); } catch (e) { fail(e); }
      });
      const kick = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: 'Исключить' });
      kick.addEventListener('click', async () => {
        try {
          const members = chat.members.filter((u) => u !== uid);
          const meta = await sealMeta(chatId, members, t.title); // исключённый больше не прочтёт новое название
          await ref.update({ members, admins: FV.arrayRemove(uid), meta, metaBy: S.user.uid, updatedAt: FV.serverTimestamp() });
          closeModal();
        } catch (e) { fail(e); }
      });
      row.append(mk, kick);
    }
    list.appendChild(row);
  }

  const nodes = [el('div', { class: 'ah-profile' }, [groupAvatar(t.title), el('h2', { text: t.title }), el('p', { class: 'hint', text: chat.members.length + ' участн. · название и сообщения зашифрованы' })]), list];

  if (isAdmin) {
    const rename = el('input', { class: 'input', maxlength: '60', value: t.title, 'aria-label': 'Название' });
    const save = el('button', { class: 'btn btn--sm', type: 'button', text: 'Переименовать' });
    save.addEventListener('click', async () => {
      const n = rename.value.trim(); if (!n) return;
      try { await ref.update({ meta: await sealMeta(chatId, chat.members, n), metaBy: S.user.uid, updatedAt: FV.serverTimestamp() }); closeModal(); } catch (e) { fail(e); }
    });
    const picker = memberPicker();
    const addBtn = el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: 'Добавить выбранных' });
    addBtn.addEventListener('click', async () => {
      const add = Array.from(picker.picked.keys()).filter((u) => chat.members.indexOf(u) === -1);
      if (!add.length) return;
      const members = chat.members.concat(add);
      if (members.length > 50) { fail(new Error('Максимум 50 участников.')); return; }
      try { await ref.update({ members, meta: await sealMeta(chatId, members, t.title), metaBy: S.user.uid, updatedAt: FV.serverTimestamp() }); closeModal(); } catch (e) { fail(e); }
    });
    nodes.push(el('div', { class: 'btn-row' }, [rename, save]), el('p', { class: 'label', text: 'Добавить участников' }), picker.node, el('div', { class: 'btn-row' }, [addBtn]),
      el('p', { class: 'hint', text: 'Новые участники видят только сообщения, отправленные после их добавления.' }));
  }

  const leave = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Покинуть группу' });
  leave.addEventListener('click', async () => {
    const soleAdmin = isAdmin && (chat.admins || []).length === 1 && chat.members.length > 1;
    if (soleAdmin) { fail(new Error('Вы единственный админ: назначьте другого или удалите группу.')); return; }
    if (!(await confirmBox('Покинуть группу?', 'Вы перестанете получать сообщения.', 'Покинуть', true))) return;
    try { await ref.update({ members: FV.arrayRemove(S.user.uid), admins: FV.arrayRemove(S.user.uid), updatedAt: FV.serverTimestamp() }); closeChat(); } catch (e) { flash(authError(e)); }
  });
  const row = [leave];
  if (isAdmin) {
    const del = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Удалить группу' });
    del.addEventListener('click', async () => {
      if (!(await confirmBox('Удалить группу?', 'Группа исчезнет у всех участников.', 'Удалить', true))) return;
      try { await ref.delete(); closeChat(); } catch (e) { flash(authError(e)); }
    });
    row.push(del);
  }
  nodes.push(st, el('div', { class: 'btn-row' }, row));
  openModal(nodes);
}

/* ── Мой профиль и безопасность ─────────────────────────────────────────── */
$('btn-me').addEventListener('click', showMe);

function showMe() {
  const me = S.profile;
  let newAvatar;
  const avaBox = avatar(me, 'ava--lg');
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const pick = el('button', { class: 'btn btn--sm', type: 'button', text: 'Сменить аватар' });
  const rmAva = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Убрать' });
  const bio = el('textarea', { class: 'textarea', maxlength: '280', rows: '3', 'aria-label': 'О себе' });
  bio.value = me.bio || '';
  const st = el('p', { class: 'status' });
  pick.addEventListener('click', () => file.click());
  rmAva.addEventListener('click', () => { newAvatar = null; avaBox.textContent = me.handle[0]; });
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    try { newAvatar = await makeAvatar(f); avaBox.textContent = ''; avaBox.appendChild(el('img', { src: newAvatar, alt: '' })); }
    catch (e) { st.textContent = e.message; st.className = 'status is-err'; }
  });
  const save = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Сохранить' });
  save.addEventListener('click', async () => {
    const upd = { bio: bio.value.trim().slice(0, 280), updatedAt: FV.serverTimestamp() };
    if (newAvatar !== undefined) upd.avatar = newAvatar;
    try {
      await db.collection('profiles').doc(S.user.uid).update(upd);
      S.profile = (await db.collection('profiles').doc(S.user.uid).get()).data();
      $('me-ava').replaceWith(Object.assign(avatar(S.profile), { id: 'me-ava' }));
      st.textContent = 'Сохранено.'; st.className = 'status is-ok';
    } catch (e) { st.textContent = authError(e); st.className = 'status is-err'; }
  });

  const changeCode = el('button', { class: 'btn btn--sm', type: 'button', text: 'Сменить код восстановления' });
  changeCode.addEventListener('click', changeRecoveryCode);
  const logout = el('button', { class: 'btn btn--sm', type: 'button' }, [icon('logout'), 'Выйти']);
  logout.addEventListener('click', doLogout);
  const delAcc = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: 'Удалить аккаунт' });
  delAcc.addEventListener('click', deleteAccount);

  openModal([
    el('div', { class: 'ah-profile' }, [avaBox, el('h2', { text: '@' + me.handle }), file, el('div', { class: 'btn-row' }, [pick, rmAva])]),
    el('p', { class: 'hint', text: 'Аватар пересжимается на устройстве, метаданные (EXIF/GPS) удаляются. Не ставьте своё фото, если важна анонимность.' }),
    el('div', { class: 'field' }, [el('label', { text: 'О себе' }), bio]),
    el('div', { class: 'btn-row' }, [save]), st,
    el('p', { class: 'hint mono', text: 'Отпечаток ключа: ' + me.fp.slice(0, 32).match(/.{4}/g).join(' ') }),
    el('div', { class: 'btn-row' }, [changeCode, logout, delAcc])
  ]);
}

async function changeRecoveryCode() {
  const old = await promptBox('Сменить код', 'Введите текущий код восстановления.', { mono: true, ok: 'Далее' });
  if (old === null) return;
  try {
    const b = await db.collection('keybackups').doc(S.user.uid).get();
    const { priv, pub } = await C.openBackup(b.data(), S.user.uid, old);
    const code = C.newRecoveryCode();
    const backup = await C.sealBackup(priv, pub, S.user.uid, code);
    const ok = await new Promise((resolve) => {
      const done = el('button', { class: 'btn btn--primary', type: 'button', text: 'Я сохранил новый код' });
      const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Отмена' });
      done.addEventListener('click', () => { closeModal(); resolve(true); });
      cancel.addEventListener('click', () => { closeModal(); resolve(false); });
      openModal([el('h2', { text: 'Новый код' }), el('div', { class: 'ah-code', id: 'new-code', text: code }), el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn--sm', type: 'button', 'data-copy-from': 'new-code', text: 'Копировать' })]), el('p', { class: 'muted', text: 'Старый код перестанет работать после сохранения.' }), el('div', { class: 'btn-row' }, [cancel, done])]);
    });
    if (!ok) return;
    await db.collection('keybackups').doc(S.user.uid).set(Object.assign({}, backup, { updatedAt: FV.serverTimestamp() }));
    flash('Код восстановления обновлён.');
  } catch (e) { flash(e.code === 'wrong-code' || e.code === 'bad-code-format' ? 'Неверный код.' : authError(e)); }
}

async function doLogout() {
  const ok = await confirmBox('Выйти?', 'Ключи шифрования будут стёрты с этого устройства. Чтобы снова читать переписку, понадобится код восстановления.', 'Выйти');
  if (!ok) return;
  const uid = S.user.uid;
  await C.deviceKeys.wipe(uid).catch(() => {});
  await C.pins.wipeAll().catch(() => {});
  try { Object.keys(localStorage).filter((k) => k.indexOf('ah:' + uid) === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  closeModal();
  await auth.signOut();
}

async function deleteAccount() {
  const typed = await promptBox('Удалить аккаунт навсегда?', 'Профиль, ник и бэкап ключей будут удалены. Отправленные сообщения останутся у собеседников (в зашифрованном виде). Введите свой ник для подтверждения.', { placeholder: S.profile.handle, danger: true, ok: 'Удалить' });
  if (typed === null) return;
  if (typed.trim().replace(/^@/, '').toLowerCase() !== S.profile.handle) { flash('Ник не совпал.'); return; }
  const uid = S.user.uid;
  try {
    const batch = db.batch();
    batch.delete(db.collection('profiles').doc(uid));
    batch.delete(db.collection('handles').doc(S.profile.handle));
    batch.delete(db.collection('keybackups').doc(uid));
    await batch.commit();
    await C.deviceKeys.wipe(uid).catch(() => {});
    await C.pins.wipeAll().catch(() => {});
    try { await auth.currentUser.delete(); }
    catch (e) {
      if (/requires-recent-login/.test(e.code || '')) {
        const pass = await promptBox('Подтвердите пароль', 'Чтобы удалить учётную запись входа, введите пароль ещё раз.', { type: 'password', ok: 'Удалить' });
        if (pass) {
          const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, pass);
          await auth.currentUser.reauthenticateWithCredential(cred);
          await auth.currentUser.delete();
        } else { await auth.signOut(); }
      } else throw e;
    }
  } catch (e) { flash(authError(e)); }
}

$('ah-img').addEventListener('click', () => $('ah-img').close());
