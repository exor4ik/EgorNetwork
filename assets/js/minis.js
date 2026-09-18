'use strict';

// ============================================================
//  🔥 FIREBASE — общая инициализация в assets/js/firebase-init.js
//  Анонимный вход: никаких email/паролей/имён из Google. Другим
//  игрокам виден только ник, который игрок сам ввёл.
// ============================================================
const fbAuth = window.EN_FB ? window.EN_FB.auth : null;
const fbDb = window.EN_FB ? window.EN_FB.db : null;
let currentUser = null;

const NICK_KEY = 'minis_nick';
const NICK_RE = /^[A-Za-zА-Яа-яЁё0-9_ .\-]{2,20}$/;

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } }

function randomNick() {
  const a = new Uint8Array(2);
  crypto.getRandomValues(a);
  return 'PLAYER-' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function getNick() {
  let n = (lsGet(NICK_KEY) || '').trim();
  if (!NICK_RE.test(n)) { n = randomNick(); lsSet(NICK_KEY, n); }
  return n;
}

async function ensureAuth() {
  if (!fbAuth) throw new Error('ONLINE UNAVAILABLE');
  if (fbAuth.currentUser) return fbAuth.currentUser;
  const cred = await fbAuth.signInAnonymously();
  return cred.user;
}

if (fbAuth) {
  fbAuth.onAuthStateChanged(user => { currentUser = user; updateAuthUI(); });
}

// ── Модалка ника (бывшая модалка логина) ──
function toggleAuthModal() {
  const m = document.getElementById('auth-modal');
  const open = !m.classList.contains('open');
  m.classList.toggle('open', open);
  document.getElementById('nick-error').textContent = '';
  if (open) {
    const inp = document.getElementById('nick-input');
    inp.value = getNick();
    setTimeout(() => inp.focus(), 50);
  }
}

function updateAuthUI() {
  const btn = document.getElementById('auth-mini-btn');
  if (btn) btn.textContent = '[ ' + getNick() + ' ]';
}

async function saveNick() {
  const inp = document.getElementById('nick-input');
  const err = document.getElementById('nick-error');
  const n = inp.value.trim().replace(/\s+/g, ' ');
  if (!NICK_RE.test(n)) { err.textContent = '2–20 СИМВОЛОВ: БУКВЫ, ЦИФРЫ, ПРОБЕЛ, _ . -'; return; }
  lsSet(NICK_KEY, n);
  updateAuthUI();
  toggleAuthModal();
  // Переименовываем уже существующие записи в таблице рекордов.
  if (!fbDb || !fbAuth || !fbAuth.currentUser) return;
  const uid = fbAuth.currentUser.uid;
  await Promise.all(LB_GAMES.map(async g => {
    const ref = fbDb.collection('minis_scores').doc(g).collection('entries').doc(uid);
    try {
      const snap = await ref.get();
      if (!snap.exists) return;
      await ref.set({ name: n, score: snap.data().score, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch (e) { /* не критично */ }
  }));
  loadLeaderboard(currentLB);
}

document.getElementById('nick-submit').addEventListener('click', saveNick);
document.getElementById('nick-input').addEventListener('keydown', e => {
  e.stopPropagation(); // не отдаём нажатия играм
  if (e.key === 'Enter') saveNick();
  if (e.key === 'Escape') toggleAuthModal();
});
updateAuthUI();

// ============================================================
//  🏆 GLOBAL LEADERBOARD
//  minis_scores/{game}/entries/{uid} = { name, score, updatedAt }
//  Правила Firestore пускают писать только в свою запись, только
//  валидный ник и только рекорд выше прежнего.
// ============================================================
const LB_GAMES = ['tetris', 'runner', 'snake', 'starfighter', 'asteroid', 'varoom', 'cosmic'];
const MAX_SCORE = 100000000;
let currentLB = 'tetris';
let leaderboardCache = {};
let lbOffline = false;

function lbRef(game) { return fbDb.collection('minis_scores').doc(game).collection('entries'); }

async function saveScore(game, score) {
  if (!fbDb || LB_GAMES.indexOf(game) === -1) return;
  score = Math.floor(Number(score));
  if (!(score > 0) || score > MAX_SCORE) return;
  try {
    const user = await ensureAuth();
    const ref = lbRef(game).doc(user.uid);
    const snap = await ref.get();
    if (snap.exists && snap.data().score >= score) return;
    await ref.set({ name: getNick(), score, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await loadLeaderboard(game);
  } catch (e) {
    console.warn('Failed to save score:', e.message);
  }
}

async function loadLeaderboard(game) {
  if (!game) game = currentLB;
  if (!fbDb) return;
  try {
    const snap = await lbRef(game).orderBy('score', 'desc').limit(20).get({ source: 'server' });
    leaderboardCache[game] = snap.docs.map(d => ({ uid: d.id, name: d.data().name, score: d.data().score }));
    lbOffline = false;
  } catch (e) {
    console.warn('Failed to load leaderboard:', e.message);
    leaderboardCache[game] = leaderboardCache[game] || [];
    lbOffline = true;
  }
  if (game === currentLB) renderLeaderboard(game);
}

async function loadAllLeaderboards() {
  if (!fbDb) return;
  showLeaderboard();
  await Promise.all(LB_GAMES.map(g => loadLeaderboard(g)));
  renderLeaderboard(currentLB);
}

// Рендер строго через textContent — раньше имя шло в innerHTML через
// сломанный escHtml (stored XSS для всех, кто открыл таблицу).
function renderLeaderboard(game) {
  const el = document.getElementById('lb-entries');
  if (!el) return;
  const scores = leaderboardCache[game] || [];
  el.textContent = '';
  if (scores.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lb-loading';
    empty.textContent = lbOffline ? 'LEADERBOARD OFFLINE' : 'NO SCORES YET';
    el.appendChild(empty);
    return;
  }
  const me = fbAuth && fbAuth.currentUser ? fbAuth.currentUser.uid : null;
  scores.slice(0, 20).forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'lb-entry';
    const rank = document.createElement('span');
    rank.className = 'rank' + (i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : '');
    rank.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = typeof s.name === 'string' ? s.name : 'UNKNOWN';
    if (me && s.uid === me) {
      const you = document.createElement('span');
      you.className = 'you';
      you.textContent = '(YOU)';
      name.appendChild(you);
    }
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = (Number(s.score) || 0).toLocaleString();
    row.append(rank, name, score);
    el.appendChild(row);
  });
}

function switchLeaderboard(game) {
  if (LB_GAMES.indexOf(game) === -1) return;
  currentLB = game;
  document.querySelectorAll('.lb-tab').forEach(t => t.classList.toggle('active', t.dataset.game === game));
  renderLeaderboard(game);
  if (!leaderboardCache[game]) loadLeaderboard(game);
}

function showLeaderboard() {
  document.getElementById('leaderboard-panel').classList.add('visible');
}

async function syncScore(game, score) {
  await saveScore(game, score);
}

function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Онлайн-лобби: подбираем чужое живое лобби, протухшие — чистим.
const LOBBY_STALE_MS = 15000;
async function findOpenLobby(collection, uid) {
  const q = await fbDb.collection(collection).where('status', '==', 'waiting').limit(10).get();
  const now = Date.now();
  for (const doc of q.docs) {
    const d = doc.data();
    const fresh = typeof d.ping === 'number' && now - d.ping < LOBBY_STALE_MS;
    if (!fresh) { doc.ref.delete().catch(() => {}); continue; } // правила разрешат только старые
    if (d.p1 && d.p1.uid !== uid) return doc;
  }
  return null;
}

// ── Локальные достижения (раньше писались в профиль в Firestore) ──
window.Achievements = {
  unlock(key) {
    const got = new Set((lsGet('minis_achievements') || '').split(',').filter(Boolean));
    if (got.has(key)) return;
    got.add(key);
    lsSet('minis_achievements', Array.from(got).join(','));
  }
};

// ── Делегирование кликов вместо inline onclick (CSP без 'unsafe-inline') ──
const UI_ACTIONS = new Set([
  'backToCatalog', 'openGame', 'switchLeaderboard', 'toggleAuthModal', 'endSaturnIntro',
  'startTetris', 'startTetrisMultiplayer', 'startTetrisGlobalMultiplayer', 'cancelGlobalTetris',
  'startSnake', 'startSnakeMultiplayer', 'startSnakeGlobalMultiplayer', 'cancelGlobalSnake',
  'startRunner', 'startStarfighter', 'startAsteroidDefense', 'startVaroom', 'startCosmic'
]);
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const name = t.getAttribute('data-act');
  if (!UI_ACTIONS.has(name) || typeof window[name] !== 'function') return;
  e.preventDefault();
  const arg = t.getAttribute('data-arg');
  arg === null ? window[name]() : window[name](arg);
});


// ============================================================
//  GLOBALS & NAVIGATION
// ============================================================
let currentTab = null;
let tetrisGame = null, runnerGame = null, snakeGame = null, starfighterGame = null, asteroidDefenseGame = null, varoomGame = null, cosmicGame = null;
let menuScene = null, cartridgeMenu = null;

function openGame(name) {
  document.getElementById('game-catalog').style.display = 'none';
  document.getElementById('selected-info').classList.remove('visible');
  document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  panel.classList.add('active');
  currentTab = name;

  if (menuScene) menuScene.stop();
  if (cartridgeMenu) cartridgeMenu.stop();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  setTimeout(() => {
    if (name === 'tetris' && tetrisGame) tetrisGame.resize();
    if (name === 'runner' && runnerGame) runnerGame.resize();
    if (name === 'starfighter' && starfighterGame) starfighterGame.resize();
     if (name === 'asteroid' && asteroidDefenseGame) asteroidDefenseGame.resize();
     if (name === 'varoom' && varoomGame) varoomGame.resize();
     if (name === 'cosmic' && cosmicGame) cosmicGame.resize();
     if (name === 'cosmic' && cosmicGame) cosmicGame.resize();
  }, 80);
}

function backToCatalog() {
  if (tetrisGame) { tetrisGame.running = false; if (tetrisGame.raf) cancelAnimationFrame(tetrisGame.raf); }
  if (tetrisDuelP1) { tetrisDuelP1.running = false; if (tetrisDuelP1.raf) cancelAnimationFrame(tetrisDuelP1.raf); }
  if (tetrisDuelP2) { tetrisDuelP2.running = false; if (tetrisDuelP2.raf) cancelAnimationFrame(tetrisDuelP2.raf); }
  if (tetrisDuelScoreInterval) { clearInterval(tetrisDuelScoreInterval); tetrisDuelScoreInterval = null; }
  tetrisDuelActive = false;
  if (runnerGame) { runnerGame.running = false; if (runnerGame.raf) cancelAnimationFrame(runnerGame.raf); }
  if (snakeGame)  { snakeGame.running = false;  if (snakeGame.raf) cancelAnimationFrame(snakeGame.raf); }
  if (starfighterGame) { starfighterGame.running = false; if (starfighterGame.raf) cancelAnimationFrame(starfighterGame.raf); }
  if (asteroidDefenseGame) { asteroidDefenseGame.running = false; if (asteroidDefenseGame.raf) cancelAnimationFrame(asteroidDefenseGame.raf); }
  if (varoomGame) { varoomGame.running = false; if (varoomGame.raf) cancelAnimationFrame(varoomGame.raf); }
  if (cosmicGame) { cosmicGame.running = false; if (cosmicGame.raf) cancelAnimationFrame(cosmicGame.raf); }

  currentTab = null;
  document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));

  const catalog = document.getElementById('game-catalog');
  catalog.style.display = 'block';

  if (menuScene) menuScene.resume();
  if (cartridgeMenu) {
    cartridgeMenu.resume();
    cartridgeMenu.isAnimating = false;
    cartridgeMenu.cartridges.forEach((c, i) => {
      const count = cartridgeMenu.configs.length;
      const spacing = 2.4;
      const totalWidth = (count - 1) * spacing;
      const startX = -totalWidth / 2;
      c.group.position.set(startX + i * spacing, 2.2, 0);
      c.group.rotation.set(-0.15, (i - (count - 1) / 2) * 0.08, 0);
      c.group.scale.setScalar(1);
      c.body.material.opacity = 1;
      c.body.material.transparent = false;
      delete c.ejectTargetY;
      delete c.ejectTargetZ;
      delete c.ejectTargetScale;
      delete c.ejectTargetRotX;
      delete c.ejectTargetRotY;
    });
    cartridgeMenu.updateBestScores();
    cartridgeMenu.selectByKeyboard(0);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
//  AUDIO
// ============================================================
function sndCartEject() {
  beep(180, 0.08, 'square', 0.18, 90);
  setTimeout(() => beep(120, 0.15, 'sawtooth', 0.22, 60), 80);
  setTimeout(() => beep(440, 0.04, 'square', 0.15), 220);
  setTimeout(() => beep(880, 0.08, 'sine', 0.12, 1200), 280);
}

let _audioCtx = null;
function ac() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function beep(freq, dur, type='square', vol=0.13, freqEnd) {
  try {
    const ctx = ac();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd) osc.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + dur);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch(e) {}
}
function sndMove()   { beep(200, 0.04, 'square',   0.08); }
function sndRotate() { beep(350, 0.06, 'triangle', 0.10); }
function sndLock()   { beep(120, 0.14, 'sawtooth', 0.14, 80); }
function sndClear(n) {
  const notes = [523, 659, 784, 1047];
  for (let i = 0; i < Math.min(n+1,4); i++)
    setTimeout(() => beep(notes[i], 0.09, 'sine', 0.18), i*75);
}
function sndOver()   { [380,280,180,80].forEach((f,i) => setTimeout(() => beep(f, 0.28, 'sawtooth', 0.18), i*130)); }
function sndJump()   { beep(440, 0.09, 'sine', 0.12, 600); }
function sndDie()    { beep(220, 0.4,  'sawtooth', 0.2, 60); }
function sndEat()    { beep(700, 0.05, 'sine', 0.14); setTimeout(() => beep(900, 0.05, 'sine', 0.14), 55); }
function sndPower()  { [440,550,660,880].forEach((f,i) => setTimeout(() => beep(f, 0.07, 'sine', 0.14), i*55)); }
function sndSelect() { beep(800, 0.05, 'square', 0.1); }

// ============================================================
//  THREE.JS HELPERS
// ============================================================
function clearGroup(grp) {
  while (grp.children.length > 0) {
    const child = grp.children[0];
    if (child.geometry) child.geometry.dispose();
    if (child.material) { if (Array.isArray(child.material)) child.material.forEach(m=>m.dispose()); else child.material.dispose(); }
    grp.remove(child);
  }
}

// ============================================================
//  3D CARTRIDGE MENU
// ============================================================
class CartridgeMenu {
  constructor() {
    this.cv = document.getElementById('cartridge-canvas');
    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cv.width = this.W;
    this.cv.height = this.H;

    this.cam = new THREE.PerspectiveCamera(55, this.W / this.H, 0.1, 100);
    this.cam.position.set(0, 3, 9);
    this.cam.lookAt(0, 2.5, 0);

    this.rdr = new THREE.WebGLRenderer({
      canvas: this.cv,
      antialias: true,
      alpha: true,
    });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.rdr.setClearColor(0x000000, 0);

    this.scene.add(new THREE.AmbientLight(0x4466aa, 0.55));
    const key = new THREE.DirectionalLight(0xaaccff, 0.85);
    key.position.set(5, 10, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xff88aa, 0.3);
    fill.position.set(-8, 5, -3);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0x88ddff, 1.2, 20);
    rim.position.set(0, 6, -4);
    this.scene.add(rim);

    this.configs = [
      {
        type: 'nes', game: 'tetris',
        bodyColor: 0xbcbcbc, labelColor: '#cc0022', labelAccent: '#ffdd44',
        title: '3D TETRIS', subtitle: 'EGOR-NET', tag: '8-BIT',
        desc: 'CLASSIC BLOCK PUZZLE IN 3D', bestKey: 'tBest',
      },
      {
        type: 'genesis', game: 'runner',
        bodyColor: 0x111111, labelColor: '#000000', labelAccent: '#ffcc00',
        title: 'PARKOUR\nRUNNER', subtitle: 'MEGA-EGOR', tag: '16-BIT',
        desc: 'INFINITE CUBE RUNNER', bestKey: 'rBest',
      },
      {
        type: 'gameboy', game: 'snake',
        bodyColor: 0xc8c4b8, labelColor: '#00aa44', labelAccent: '#ffffff',
        title: 'CYBER\nSNAKE', subtitle: 'POCKET-NET', tag: 'DMG',
        desc: 'DATA STREAM IN THE GRID', bestKey: 'sHigh',
      },
      {
        type: 'snes', game: 'starfighter',
        bodyColor: 0xd4d0c8, labelColor: '#1a3a88', labelAccent: '#ffdd00',
        title: 'STARFIGHTER', subtitle: 'SUPER-NET', tag: '32-BIT',
        desc: '3D SPACE SHOOTER', bestKey: 'sfBest',
      },
      {
        type: 'n64', game: 'asteroid',
        bodyColor: 0x555555, labelColor: '#aa0066', labelAccent: '#00ffcc',
        title: 'ASTEROID\nDEFENSE', subtitle: 'N64-NET', tag: '64-BIT',
        desc: 'ORBITAL TURRET DEFENSE', bestKey: 'adBest',
      },
      {
        type: 'atari', game: 'varoom',
        bodyColor: 0x8b4513, labelColor: '#331100', labelAccent: '#ff8800',
        title: 'VAROOM', subtitle: 'TEMPLE-NET', tag: '2600',
        desc: 'PSEUDO-3D HIGHWAY RACER', bestKey: 'vBest',
      },
      {
        type: 'n64', game: 'cosmic',
        bodyColor: 0x2a3a4a, labelColor: '#0a0a2a', labelAccent: '#00ffcc',
        title: 'COSMIC\nDEFENDER', subtitle: 'SPACE-WAR', tag: '32-BIT',
        desc: 'DEFEND THE GALAXY', bestKey: 'cBest',
      },
    ];

    this.cartridges = [];
    this._buildCartridges();

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.hoveredIndex = -1;
    this.selectedIndex = 0;
    this.isAnimating = false;

    this._onMove = e => this._handleMove(e);
    this._onClick = e => this._handleClick(e);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('click', this._onClick);
    window.addEventListener('resize', () => this._onResize());

    this.time = 0;
    this.running = true;
    this.raf = null;
    this.lastT = performance.now();
    this._loop(this.lastT);

    this.updateBestScores();
    this.selectByKeyboard(0);
  }

  _buildCartridges() {
    const count = this.configs.length;
    const spacing = 2.4;
    const totalWidth = (count - 1) * spacing;
    const startX = -totalWidth / 2;

    this.configs.forEach((cfg, i) => {
      const cart = this._createCartridge(cfg);
      cart.group.position.set(startX + i * spacing, 2.2, 0);
      cart.group.rotation.x = -0.15;
      cart.group.rotation.y = (i - (count - 1) / 2) * 0.08;
      this.scene.add(cart.group);
      cart.targetY = 2.2;
      cart.targetZ = 0;
      cart.targetScale = 1;
      cart.baseY = 2.2;
      cart.phase = Math.random() * Math.PI * 2;
      this.cartridges.push(cart);
    });
  }

  _createCartridge(cfg) {
    const group = new THREE.Group();

    let bodyGeo, w, h, d;
    switch (cfg.type) {
      case 'nes': w = 1.7; h = 1.2; d = 0.22; break;
      case 'genesis': w = 1.9; h = 1.35; d = 0.25; break;
      case 'gameboy': w = 1.3; h = 1.15; d = 0.18; break;
      case 'snes': w = 1.8; h = 1.25; d = 0.24; break;
      case 'n64': w = 1.9; h = 1.45; d = 0.3; break;
      case 'atari': w = 1.7; h = 1.1; d = 0.22; break;
    }
    bodyGeo = new THREE.BoxGeometry(w, h, d);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: cfg.bodyColor, metalness: 0.3, roughness: 0.55,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    if (cfg.type === 'nes' || cfg.type === 'snes') {
      const notchGeo = new THREE.BoxGeometry(w * 0.6, 0.08, d * 1.05);
      const notch = new THREE.Mesh(notchGeo, bodyMat);
      notch.position.set(0, h / 2 + 0.04, 0);
      group.add(notch);
    }

    const connGeo = new THREE.BoxGeometry(w * 0.75, 0.15, d * 0.7);
    const connMat = new THREE.MeshStandardMaterial({
      color: 0x222222, metalness: 0.8, roughness: 0.4,
    });
    const conn = new THREE.Mesh(connGeo, connMat);
    conn.position.set(0, -h / 2 - 0.075, 0);
    group.add(conn);

    const pinsGeo = new THREE.BoxGeometry(w * 0.65, 0.08, d * 0.5);
    const pinsMat = new THREE.MeshStandardMaterial({
      color: 0xccaa33, metalness: 0.95, roughness: 0.2,
      emissive: 0x443300, emissiveIntensity: 0.3,
    });
    const pins = new THREE.Mesh(pinsGeo, pinsMat);
    pins.position.set(0, -h / 2 - 0.17, 0);
    group.add(pins);

    const labelTexture = this._createLabelTexture(cfg, 0);
    const labelW = w * 0.88;
    const labelH = h * 0.6;
    const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTexture });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, h * 0.05, d / 2 + 0.002);
    group.add(label);

    for (let side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const grooveGeo = new THREE.BoxGeometry(0.02, 0.15, d * 0.7);
        const grooveMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
        const groove = new THREE.Mesh(grooveGeo, grooveMat);
        groove.position.set(side * (w / 2 - 0.04), -h * 0.25 + i * 0.18, 0);
        group.add(groove);
      }
    }

    const screwGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8);
    const screwMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.9, roughness: 0.3 });
    const screwPositions = [
      [-w * 0.42, h * 0.42, d / 2 + 0.01],
      [ w * 0.42, h * 0.42, d / 2 + 0.01],
      [-w * 0.42,-h * 0.42, d / 2 + 0.01],
      [ w * 0.42,-h * 0.42, d / 2 + 0.01],
    ];
    screwPositions.forEach(p => {
      const screw = new THREE.Mesh(screwGeo, screwMat);
      screw.position.set(p[0], p[1], p[2]);
      screw.rotation.x = Math.PI / 2;
      group.add(screw);
    });

    const edgeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo), edgeMat);
    group.add(edges);

    return { group, body, edges, edgeMat, bodyMat, label, labelTexture, config: cfg };
  }

  _createLabelTexture(cfg, bestScore = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 340;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = cfg.labelColor;
    ctx.fillRect(0, 0, 512, 340);

    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, cfg.labelAccent);
    grad.addColorStop(0.5, cfg.labelAccent + 'aa');
    grad.addColorStop(1, cfg.labelAccent);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 14);
    ctx.fillRect(0, 326, 512, 14);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 512; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 340); ctx.stroke();
    }
    for (let i = 0; i < 340; i += 16) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }

    ctx.fillStyle = cfg.labelAccent;
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`◆ ${cfg.tag}`, 20, 45);

    // Show global leaderboard top score on cartridge label if available
    const lk = cfg.bestKey;
    const globalTop = localStorage.getItem('global_' + lk);
    if (globalTop && parseInt(globalTop) > bestScore) {
      bestScore = parseInt(globalTop);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px "Courier New", monospace';
    ctx.textAlign = 'center';
    const titleLines = cfg.title.split('\n');
    const titleStartY = titleLines.length === 1 ? 145 : 130;
    titleLines.forEach((line, idx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillText(line, 258, titleStartY + idx * 46 + 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, 256, titleStartY + idx * 46);
    });

    ctx.fillStyle = cfg.labelAccent;
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillText(cfg.subtitle, 256, 230);

    ctx.strokeStyle = cfg.labelAccent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(120, 255);
    ctx.lineTo(392, 255);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText('© EGORNETWORK ENTERTAINMENT', 256, 285);
    ctx.fillText('LICENSED FOR HOME USE', 256, 305);

    if (bestScore > 0) {
      ctx.fillStyle = cfg.labelAccent;
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillText(`BEST: ${bestScore.toLocaleString()}`, 256, 70);
    }

    ctx.fillStyle = cfg.labelAccent;
    ctx.font = '16px monospace';
    ctx.fillText('★', 30, 310);
    ctx.fillText('★', 482, 310);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  updateBestScores() {
    this.cartridges.forEach((cart, i) => {
      const cfg = this.configs[i];
      let best = parseInt(localStorage.getItem(cfg.bestKey) || '0');
      // Check global leaderboard cache
      const globalBest = leaderboardCache[cfg.game] && leaderboardCache[cfg.game].length > 0
        ? leaderboardCache[cfg.game][0].score : 0;
      if (globalBest > best) best = globalBest;
      if (cart.labelTexture) cart.labelTexture.dispose();
      cart.labelTexture = this._createLabelTexture(cfg, best);
      cart.label.material.map = cart.labelTexture;
      cart.label.material.needsUpdate = true;
    });
  }

  _handleMove(e) {
    if (!this.running) return;
    const rect = this.cv.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _handleClick(e) {
    if (!this.running || this.hoveredIndex < 0) return;
    if (currentTab !== null) return;
    if (this.isAnimating) return;

    const idx = this.hoveredIndex;
    const cfg = this.configs[idx];
    this._ejectAnimation(idx, cfg.game);
  }

  _ejectAnimation(index, gameName) {
    this.isAnimating = true;
    sndCartEject();

    const flickerEl = document.getElementById('crt-flicker');
    const labelEl = document.getElementById('cart-eject-label');
    
    setTimeout(() => {
      flickerEl.classList.add('active');
      labelEl.classList.add('show');
    }, 250);

    this.cartridges.forEach((c, i) => {
      c.origY = c.group.position.y;
      c.origZ = c.group.position.z;
      c.origScale = c.group.scale.x;
      c.origRotX = c.group.rotation.x;
      c.origRotY = c.group.rotation.y;
    });

    const selected = this.cartridges[index];
    selected.ejectTargetY = 6;
    selected.ejectTargetZ = 2;
    selected.ejectTargetScale = 1.3;
    selected.ejectTargetRotX = -0.4;
    selected.ejectTargetRotY = 0.3;
    selected.animPhase = 0;
    selected.animStart = performance.now();

    this.cartridges.forEach((c, i) => {
      if (i === index) return;
      const dir = i < index ? -1 : 1;
      c.ejectTargetY = 2;
      c.ejectTargetZ = -8;
      c.ejectTargetScale = 0.4;
      c.ejectTargetRotY = dir * 0.8;
      c.animPhase = 1;
      c.animStart = performance.now() + 150 + Math.abs(i - index) * 40;
    });

    setTimeout(() => {
      flickerEl.classList.remove('active');
      labelEl.classList.remove('show');

      setTimeout(() => {
        this.isAnimating = false;
        openGame(gameName);
      }, 100);
    }, 1100);
  }

  selectByKeyboard(index) {
    if (index < 0 || index >= this.cartridges.length) return;
    this.selectedIndex = index;
    this.cartridges.forEach((c, i) => {
      if (i === index) {
        c.targetY = c.baseY + 0.6;
        c.targetZ = 1.2;
        c.targetScale = 1.12;
        c.edgeMat.opacity = 0.9;
      } else {
        c.targetY = c.baseY;
        c.targetZ = 0;
        c.targetScale = 1;
        c.edgeMat.opacity = 0;
      }
    });
    this._updateSelectedInfo(index);
  }

  _updateSelectedInfo(index) {
    const infoEl = document.getElementById('selected-info');
    if (index < 0 || !infoEl) {
      if (infoEl) infoEl.classList.remove('visible');
      return;
    }
    const cfg = this.configs[index];
    const titleEl = document.getElementById('sel-title');
    const descEl = document.getElementById('sel-desc');
    const bestEl = document.getElementById('sel-best');
    if (titleEl) titleEl.textContent = cfg.title.replace('\n', ' ');
    if (descEl) descEl.textContent = cfg.desc;
    let best = parseInt(localStorage.getItem(cfg.bestKey) || '0');
    const globalBest = leaderboardCache[cfg.game] && leaderboardCache[cfg.game].length > 0
      ? leaderboardCache[cfg.game][0].score : 0;
    if (globalBest > best) best = globalBest;
    if (bestEl) {
      if (best > 0) {
        bestEl.innerHTML = `GLOBAL BEST: ${best.toLocaleString()}`;
        if (globalBest > 0) bestEl.innerHTML = `🌐 GLOBAL BEST: ${globalBest.toLocaleString()}`;
      } else {
        bestEl.textContent = '';
      }
    }
    infoEl.classList.add('visible');
  }

  _onResize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cv.width = this.W;
    this.cv.height = this.H;
    this.cam.aspect = this.W / this.H;
    this.cam.updateProjectionMatrix();
    this.rdr.setSize(this.W, this.H);
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    this.time += dt;

    this.raycaster.setFromCamera(this.mouse, this.cam);
    const bodies = this.cartridges.map(c => c.body);
    const intersects = this.raycaster.intersectObjects(bodies);

    let newHovered = -1;
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const idx = bodies.indexOf(hit);
      if (idx >= 0) newHovered = idx;
    }

    if (newHovered !== this.hoveredIndex) {
      this.hoveredIndex = newHovered;
      const activeIndex = newHovered >= 0 ? newHovered : this.selectedIndex;
      this.cartridges.forEach((c, i) => {
        if (i === activeIndex) {
          c.targetY = c.baseY + 0.6;
          c.targetZ = 1.2;
          c.targetScale = 1.12;
          c.edgeMat.opacity = 0.9;
        } else {
          c.targetY = c.baseY;
          c.targetZ = 0;
          c.targetScale = 1;
          c.edgeMat.opacity = 0;
        }
      });
      this._updateSelectedInfo(activeIndex);
    }
    
    this.cartridges.forEach((c, i) => {
      const g = c.group;
      if (this.isAnimating && c.ejectTargetY !== undefined) {
        const elapsed = performance.now() - c.animStart;
        if (elapsed < 0) return;
        
        const duration = 900;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        
        const startY = c.origY;
        const startZ = c.origZ;
        const startScale = c.origScale;
        const startRotX = c.origRotX;
        const startRotY = c.origRotY;
        
        if (c.animPhase === 0) {
          let p;
          if (progress < 0.25) {
            p = progress / 0.25;
            const dipEase = Math.sin(p * Math.PI * 0.5);
            g.position.y = startY - 0.25 * dipEase;
            g.position.z = startZ + 0.1 * dipEase;
            g.scale.setScalar(startScale + 0.05 * dipEase);
            g.rotation.z = Math.sin(elapsed * 0.05) * 0.05;
          } else {
            p = (progress - 0.25) / 0.75;
            const overshoot = 1 - Math.pow(1 - p, 3);
            const bounce = Math.sin(p * Math.PI * 1.5) * 0.15 * (1 - p);
            g.position.y = startY + (c.ejectTargetY - startY) * overshoot + bounce;
            g.position.z = startZ + (c.ejectTargetZ - startZ) * overshoot;
            g.scale.setScalar(startScale + (c.ejectTargetScale - startScale) * overshoot);
            g.rotation.x = startRotX + (c.ejectTargetRotX - startRotX) * overshoot;
            g.rotation.y = startRotY + (c.ejectTargetRotY - startRotY) * overshoot;
            g.rotation.z = Math.sin(elapsed * 0.02) * 0.04 * (1 - p);
          }
        } else {
          g.position.y = startY + (c.ejectTargetY - startY) * ease;
          g.position.z = startZ + (c.ejectTargetZ - startZ) * ease;
          const scaleVal = startScale + (c.ejectTargetScale - startScale) * ease;
          g.scale.setScalar(scaleVal);
          g.rotation.y = startRotY + (c.ejectTargetRotY - startRotY) * ease;
          if (c.body.material.opacity > 0) {
            c.body.material.transparent = true;
            c.body.material.opacity = Math.max(0, 1 - progress * 1.2);
          }
        }
        return;
      }

      const bob = Math.sin(this.time * 1.2 + c.phase) * 0.08;
      const wobble = Math.sin(this.time * 0.8 + c.phase * 1.3) * 0.03;
      g.position.y += (c.targetY + bob - g.position.y) * 0.1;
      g.position.z += (c.targetZ - g.position.z) * 0.12;
      const curScale = g.scale.x;
      const newScale = curScale + (c.targetScale - curScale) * 0.12;
      g.scale.setScalar(newScale);
      g.rotation.z = wobble;
    });

    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.cv.style.display = 'none';
  }

  resume() {
    if (this.running) return;
    this.cv.style.display = 'block';
    this.running = true;
    this.lastT = performance.now();
    this._loop(this.lastT);
  }

  dispose() {
    this.stop();
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('click', this._onClick);
  }
}

// ============================================================
//  PS2 STYLE MAIN MENU
// ============================================================
class MenuScene {
  constructor() {
    this.cv = document.getElementById('menu-canvas');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000814);
    this.scene.fog = new THREE.FogExp2(0x001020, 0.012);

    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cv.width = this.W; this.cv.height = this.H;

    this.cam = new THREE.PerspectiveCamera(65, this.W / this.H, 0.1, 300);
    this.cam.position.set(0, 18, 28);
    this.cam.lookAt(0, 8, 0);

    this.rdr = new THREE.WebGLRenderer({
      canvas: this.cv,
      antialias: true,
      alpha: false,
    });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    this.scene.add(new THREE.AmbientLight(0x2244aa, 0.4));
    const topLight = new THREE.DirectionalLight(0x88bbff, 0.6);
    topLight.position.set(0, 30, 10);
    this.scene.add(topLight);

    const backLight = new THREE.DirectionalLight(0x4466cc, 0.3);
    backLight.position.set(-15, 20, -20);
    this.scene.add(backLight);

    const bottomLight = new THREE.PointLight(0x0066ff, 1.5, 80);
    bottomLight.position.set(0, -5, 0);
    this.scene.add(bottomLight);

    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x001830,
      emissive: 0x000814,
      emissiveIntensity: 0.5,
      metalness: 0.9,
      roughness: 0.4,
      transparent: true,
      opacity: 0.85,
    });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -1;
    this.scene.add(this.floor);

    this.towers = [];
    this._buildTowers();
    this._buildParticles();

    this.time = 0;
    this.running = true;
    this.raf = null;
    this.lastT = performance.now();
    this._loop(this.lastT);

    this._resizeHandler = () => this._onResize();
    window.addEventListener('resize', this._resizeHandler);
  }

  _buildTowers() {
    const gridSize = 9;
    const spacing = 4.5;
    const halfGrid = (gridSize * spacing) / 2;

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const x = i * spacing - halfGrid + (Math.random() - 0.5) * 0.8;
        const z = j * spacing - halfGrid + (Math.random() - 0.5) * 0.8;

        const height = 3 + Math.pow(Math.random(), 1.5) * 18;

        const palettes = [
          { base: 0x1a4d99, em: 0x3388ff },
          { base: 0x2a66cc, em: 0x55aaff },
          { base: 0x0066aa, em: 0x00aadd },
          { base: 0x3355aa, em: 0x6699ff },
          { base: 0x2244bb, em: 0x4488ff },
          { base: 0x5522aa, em: 0x8844ff },
          { base: 0x3366cc, em: 0x66aaff },
        ];
        const pal = palettes[Math.floor(Math.random() * palettes.length)];

        const mat = new THREE.MeshPhysicalMaterial({
          color: pal.base,
          emissive: pal.em,
          emissiveIntensity: 0.35 + Math.random() * 0.3,
          transparent: true,
          opacity: 0.55 + Math.random() * 0.25,
          metalness: 0.3,
          roughness: 0.15,
          transmission: 0.2,
          thickness: 0.5,
          side: THREE.DoubleSide,
        });

        let geo;
        const shape = Math.random();
        if (shape < 0.6) {
          const w = 1.2 + Math.random() * 1.2;
          geo = new THREE.BoxGeometry(w, height, w);
        } else if (shape < 0.85) {
          const r = 0.7 + Math.random() * 0.6;
          geo = new THREE.CylinderGeometry(r, r, height, 16);
        } else {
          const r = 0.8 + Math.random() * 0.7;
          geo = new THREE.CylinderGeometry(r, r, height, 6);
        }

        const tower = new THREE.Mesh(geo, mat);
        tower.position.set(x, height / 2 - 1, z);

        const edgeMat = new THREE.LineBasicMaterial({
          color: pal.em,
          transparent: true,
          opacity: 0.5,
        });
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
        tower.add(edges);

        this.scene.add(tower);

        this.towers.push({
          mesh: tower,
          baseHeight: height,
          baseY: height / 2 - 1,
          phase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.3 + Math.random() * 0.5,
          baseEmissive: 0.35 + Math.random() * 0.3,
        });
      }
    }
  }

  _buildParticles() {
    const count = 400;
    const pts = [];
    for (let i = 0; i < count; i++) {
      pts.push(new THREE.Vector3(
        (Math.random() - 0.5) * 120,
        Math.random() * 40 - 5,
        (Math.random() - 0.5) * 120,
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 0.25,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);

    const pts2 = [];
    for (let i = 0; i < 80; i++) {
      pts2.push(new THREE.Vector3(
        (Math.random() - 0.5) * 80,
        Math.random() * 30,
        (Math.random() - 0.5) * 80,
      ));
    }
    const geo2 = new THREE.BufferGeometry().setFromPoints(pts2);
    const mat2 = new THREE.PointsMaterial({
      color: 0xaaddff,
      size: 0.8,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
    });
    this.particles2 = new THREE.Points(geo2, mat2);
    this.scene.add(this.particles2);
  }

  _onResize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cv.width = this.W; this.cv.height = this.H;
    this.cam.aspect = this.W / this.H;
    this.cam.updateProjectionMatrix();
    this.rdr.setSize(this.W, this.H);
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    this.time += dt;

    const camRadius = 32;
    const camSpeed = 0.04;
    const camAngle = this.time * camSpeed;
    this.cam.position.x = Math.cos(camAngle) * camRadius;
    this.cam.position.z = Math.sin(camAngle) * camRadius + 8;
    this.cam.position.y = 16 + Math.sin(this.time * 0.15) * 3;
    this.cam.lookAt(0, 7, 0);

    for (const t2 of this.towers) {
      const pulse = Math.sin(this.time * t2.pulseSpeed + t2.phase);
      t2.mesh.material.emissiveIntensity = t2.baseEmissive + pulse * 0.15;
      t2.mesh.material.opacity = 0.55 + pulse * 0.1;
      t2.mesh.position.y = t2.baseY + pulse * 0.3;
    }

    this.particles.rotation.y += dt * 0.02;
    this.particles2.rotation.y -= dt * 0.015;
    this.particles2.position.y = Math.sin(this.time * 0.3) * 1.5;

    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.cv.style.display = 'none';
  }

  resume() {
    if (this.running) return;
    this.cv.style.display = 'block';
    this.running = true;
    this.lastT = performance.now();
    this._loop(this.lastT);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._resizeHandler);
    this.rdr.dispose();
  }
}

// ============================================================
//  3D TETRIS
// ============================================================
const TC = 10, TR = 20;

const SHAPES = [
  { s: [[1,1,1,1]],          c: 0x00eeff },
  { s: [[1,1],[1,1]],        c: 0xffee00 },
  { s: [[0,1,0],[1,1,1]],    c: 0xcc00ff },
  { s: [[0,1,1],[1,1,0]],    c: 0x00ff55 },
  { s: [[1,1,0],[0,1,1]],    c: 0xff2244 },
  { s: [[1,0,0],[1,1,1]],    c: 0x2255ff },
  { s: [[0,0,1],[1,1,1]],    c: 0xff8800 },
];

function rotateCW(m) {
  const R=m.length, C=m[0].length;
  const out = Array.from({length:C}, ()=>Array(R).fill(0));
  for (let r=0;r<R;r++) for (let c=0;c<C;c++) out[c][R-1-r]=m[r][c];
  return out;
}
function randPiece() {
  const p = SHAPES[Math.floor(Math.random()*SHAPES.length)];
  return { shape: p.s.map(r=>[...r]), color: p.c, x: 3, y: -2 };
}

class Tetris3D {
  constructor() {
    this.cv = document.getElementById('tetris-canvas');
    this.wrap = this.cv.parentElement;
    this.W = this.wrap.clientWidth; this.H = this.wrap.clientHeight || 560;
    this.cv.width = this.W; this.cv.height = this.H;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020209);

    this.cam = new THREE.PerspectiveCamera(52, this.W/this.H, 0.1, 120);
    this.cam.position.set(5, 9, 22);
    this.cam.lookAt(5, 9, 0);

    this.rdr = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.add(new THREE.AmbientLight(0x112233, 0.7));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9);
    dl.position.set(8, 20, 15); this.scene.add(dl);
    this.glow = new THREE.PointLight(0x00ffcc, 2, 28);
    this.glow.position.set(5, 9, 6); this.scene.add(this.glow);

    this._buildBorderGrid();

    this.grpBoard  = new THREE.Group(); this.scene.add(this.grpBoard);
    this.grpActive = new THREE.Group(); this.scene.add(this.grpActive);
    this.grpGhost  = new THREE.Group(); this.scene.add(this.grpGhost);
    this.grpFX     = new THREE.Group(); this.scene.add(this.grpFX);

    this.nxCtx = document.getElementById('t-next-canvas').getContext('2d');
    this.hdCtx = document.getElementById('t-hold-canvas').getContext('2d');

    this.board = null; this.active = null; this.next = null;
    this.held = null;  this.canHold = true;
    this.score = 0; this.level = 1; this.lines = 0;
    this.running = false; this.raf = null;
    this.dropTimer = 0; this.dropInterval = 800;
    this.particles = [];
    this.lastT = 0;

    this.best = parseInt(localStorage.getItem('tBest') || '0');

    this.resize();
    this.rdr.render(this.scene, this.cam);
  }

  _buildBorderGrid() {
    const bMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5 });
    const bPts = [
      new THREE.Vector3(-0.5,-0.5,0),
      new THREE.Vector3(TC-0.5,-0.5,0),
      new THREE.Vector3(TC-0.5,TR-0.5,0),
      new THREE.Vector3(-0.5,TR-0.5,0),
      new THREE.Vector3(-0.5,-0.5,0),
    ];
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bPts), bMat));

    const gMat = new THREE.LineBasicMaterial({ color: 0x003322, transparent: true, opacity: 0.25 });
    const gPts = [];
    for (let x=0; x<=TC; x++) { gPts.push(new THREE.Vector3(x-0.5,-0.5,0)); gPts.push(new THREE.Vector3(x-0.5,TR-0.5,0)); }
    for (let y=0; y<=TR; y++) { gPts.push(new THREE.Vector3(-0.5,y-0.5,0)); gPts.push(new THREE.Vector3(TC-0.5,y-0.5,0)); }
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gPts), gMat));

    const dMat = new THREE.LineBasicMaterial({ color: 0x004433, transparent: true, opacity: 0.3 });
    const dPts = [];
    const corners = [[-0.5,-0.5],[TC-0.5,-0.5],[-0.5,TR-0.5],[TC-0.5,TR-0.5]];
    corners.forEach(([x,y]) => { dPts.push(new THREE.Vector3(x,y,0)); dPts.push(new THREE.Vector3(x,y,-2)); });
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dPts), dMat));
  }

  _makeMat(color, emissiveInt=0.4, transparent=false, opacity=1) {
    return new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: emissiveInt,
      roughness: 0.25, metalness: 0.65,
      transparent, opacity,
    });
  }

  start() {
    this.board = Array.from({length:TR}, ()=>Array(TC).fill(0));
    this.score = 0; this.level = 1; this.lines = 0;
    this.held = null; this.canHold = true;
    this.running = true; this.particles = [];
    this.dropInterval = 800; this.dropTimer = 0;
    clearGroup(this.grpBoard); clearGroup(this.grpActive);
    clearGroup(this.grpGhost); clearGroup(this.grpFX);
    this.next = randPiece(); this.spawnPiece();
    this._updateHUD();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.lastT = performance.now(); this._loop(this.lastT);
  }

  spawnPiece() {
    this.active = this.next;
    this.active.x = Math.floor((TC - this.active.shape[0].length) / 2);
    this.active.y = -1;
    this.next = randPiece(); this.canHold = true;
    this._drawPreview(this.nxCtx, this.next);
    if (!this._valid(this.active.shape, this.active.x, this.active.y)) this._gameOver();
  }

  _valid(shape, px, py) {
    for (let r=0; r<shape.length; r++) for (let c=0; c<shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const bx=px+c, by=py+r;
      if (bx<0 || bx>=TC || by>=TR) return false;
      if (by>=0 && this.board[by][bx]) return false;
    }
    return true;
  }

  _ghostY() {
    let gy = this.active.y;
    while (this._valid(this.active.shape, this.active.x, gy+1)) gy++;
    return gy;
  }

  move(dx) { if (this._valid(this.active.shape, this.active.x+dx, this.active.y)) { this.active.x+=dx; sndMove(); } }
  rotate()  {
    const rot = rotateCW(this.active.shape);
    const kicks = [0,-1,1,-2,2];
    for (const k of kicks) { if (this._valid(rot, this.active.x+k, this.active.y)) { this.active.shape=rot; this.active.x+=k; sndRotate(); return; } }
  }
  softDrop() { if (this._valid(this.active.shape, this.active.x, this.active.y+1)) { this.active.y++; this.score++; this.dropTimer=0; } else this._lock(); }
  hardDrop() { const gy=this._ghostY(); this.score+=(gy-this.active.y)*2; this.active.y=gy; this._lock(); }
  holdPiece() {
    if (!this.canHold) return;
    this.canHold = false;
    if (!this.held) { this.held={shape:this.active.shape,color:this.active.color}; this.spawnPiece(); }
    else { const t=this.held; this.held={shape:this.active.shape,color:this.active.color}; this.active={shape:t.shape,color:t.color,x:3,y:-1}; }
    this._drawPreview(this.hdCtx, this.held);
  }

  _lock() {
    const {shape,x,y,color} = this.active;
    for (let r=0;r<shape.length;r++) for (let c=0;c<shape[r].length;c++) {
      if (!shape[r][c]) continue;
      if (y+r < 0) { this._gameOver(); return; }
      this.board[y+r][x+c] = color;
    }
    sndLock();
    const cleared = this._clearLines();
    if (cleared > 0) {
      const pts = [0,100,300,500,800][cleared] * this.level;
      this.score += pts; this.lines += cleared;
      this.level = Math.floor(this.lines/10)+1;
      this.dropInterval = Math.max(80, 800-(this.level-1)*70);
      sndClear(cleared);
    }
    this._rebuildBoard();
    this._updateHUD();
    this.spawnPiece();
  }

  _clearLines() {
    let count = 0;
    for (let r=TR-1; r>=0; r--) {
      if (this.board[r].every(v=>v!==0)) {
        this._spawnClearFX(r);
        this.board.splice(r,1);
        this.board.unshift(Array(TC).fill(0));
        count++; r++;
      }
    }
    return count;
  }

  _spawnClearFX(row) {
    for (let c=0; c<TC; c++) {
      const col = this.board[row][c] || 0x00ffcc;
      for (let i=0; i<4; i++) {
        const g = new THREE.BoxGeometry(0.12,0.12,0.12);
        const m = new THREE.MeshBasicMaterial({ color: col, transparent: true });
        const mesh = new THREE.Mesh(g,m);
        mesh.position.set(c, TR-1-row, 0.5);
        const vel = { x:(Math.random()-.5)*.25, y:Math.random()*.35+.08, z:Math.random()*.2 };
        this.grpFX.add(mesh);
        this.particles.push({ mesh, vel, life: 1.0 });
      }
    }
  }

  _rebuildBoard() {
    clearGroup(this.grpBoard);
    for (let r=0;r<TR;r++) for (let c=0;c<TC;c++) {
      const color = this.board[r][c];
      if (!color) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.91,0.91,0.91), this._makeMat(color, 0.28));
      mesh.position.set(c, TR-1-r, 0);
      this.grpBoard.add(mesh);
    }
  }

  _rebuildActive() {
    clearGroup(this.grpActive); clearGroup(this.grpGhost);
    if (!this.active || !this.running) return;
    const {shape,x,y,color} = this.active;
    const gy = this._ghostY();
    for (let r=0;r<shape.length;r++) for (let c=0;c<shape[r].length;c++) {
      if (!shape[r][c]) continue;
      const am = new THREE.Mesh(new THREE.BoxGeometry(0.91,0.91,0.91), this._makeMat(color, 0.75));
      am.position.set(x+c, TR-1-(y+r), 0.35);
      this.grpActive.add(am);
      const gm = new THREE.Mesh(new THREE.BoxGeometry(0.87,0.87,0.87),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.22 }));
      gm.position.set(x+c, TR-1-(gy+r), 0);
      this.grpGhost.add(gm);
    }
  }

  _drawPreview(ctx, piece) {
    ctx.fillStyle = '#020209';
    ctx.fillRect(0,0,72,72);
    if (!piece) return;
    const {shape,color} = piece;
    const cs = 14;
    const ox = Math.floor((72-shape[0].length*cs)/2);
    const oy = Math.floor((72-shape.length*cs)/2);
    const hex = '#'+color.toString(16).padStart(6,'0');
    ctx.fillStyle = hex;
    ctx.shadowColor = hex; ctx.shadowBlur = 7;
    for (let r=0;r<shape.length;r++) for (let c=0;c<shape[r].length;c++)
      if (shape[r][c]) ctx.fillRect(ox+c*cs+1, oy+r*cs+1, cs-2, cs-2);
    ctx.shadowBlur = 0;
  }

  _updateHUD() {
    document.getElementById('t-score').textContent = this.score.toLocaleString();
    document.getElementById('t-level').textContent = this.level;
    document.getElementById('t-lines').textContent = this.lines;
  }

  _gameOver() {
    this.running = false;
    sndOver();
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('tBest', this.best);
      syncScore('tetris', this.score);
    }
    const isRec = this.score >= this.best && this.score > 0;
    const ov = document.getElementById('tetris-overlay');
    ov.innerHTML = `<h2>GAME OVER</h2><div class="score-big">SCORE: ${this.score.toLocaleString()}</div><div class="subtitle">LINES: ${this.lines} &nbsp;|&nbsp; LEVEL: ${this.level}</div>${isRec?'<div class="new-rec">▓ NEW RECORD ▓</div>':`<div class="subtitle">BEST: ${this.best.toLocaleString()}</div>`}<button class="start-btn" data-act="startTetris">[ PLAY AGAIN ]</button><button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
    ov.style.display = 'flex';
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min(t - this.lastT, 50); this.lastT = t;
    this.dropTimer += dt;
    if (this.dropTimer >= this.dropInterval) {
      this.dropTimer = 0;
      if (this._valid(this.active.shape, this.active.x, this.active.y+1)) this.active.y++;
      else this._lock();
    }
    this.particles = this.particles.filter(p => {
      p.life -= 0.025;
      p.vel.y -= 0.012; p.mesh.position.x+=p.vel.x; p.mesh.position.y+=p.vel.y; p.mesh.position.z+=p.vel.z;
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) { this.grpFX.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); return false; }
      return true;
    });
    this.glow.intensity = 1.4 + Math.sin(t*.004)*.35;
    this._rebuildActive();
    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  resize() {
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight||560;
    this.cv.width=W; this.cv.height=H;
    this.cam.aspect=W/H; this.cam.updateProjectionMatrix();
    this.rdr.setSize(W,H);
  }

  handleKey(e) {
    if (!this.running) return;
    switch(e.code) {
      case 'ArrowLeft':  e.preventDefault(); this.move(-1); break;
      case 'ArrowRight': e.preventDefault(); this.move(1);  break;
      case 'ArrowUp': case 'KeyZ': e.preventDefault(); this.rotate();   break;
      case 'ArrowDown':  e.preventDefault(); this.softDrop(); break;
      case 'Space':      e.preventDefault(); this.hardDrop(); break;
      case 'KeyC':       e.preventDefault(); this.holdPiece(); break;
    }
  }
}

function startTetris() {
  document.getElementById('tetris-overlay').style.display = 'none';
  if (!tetrisGame) tetrisGame = new Tetris3D();
  tetrisGame.start();
}

// ============================================================
//  TETRIS LOCAL DUEL (2P side-by-side, real competition)
// ============================================================
// Two independent Tetris boards. Both play simultaneously.
// Winner = who survives longer. If both die, more lines wins.

let tetrisDuelActive = false;
let tetrisP1 = null; // instance for player 1
let tetrisP2 = null; // instance for player 2

class TetrisDuel3D {
  constructor(canvasId, playerName, accentColor = 0x00ffcc) {
    this.cv = document.getElementById(canvasId);
    this.wrap = this.cv.parentElement;
    this.playerName = playerName;
    this.accentColor = accentColor;

    this.TC = 10;
    this.TR = 20;

    this.W = this.wrap.clientWidth || 400;
    this.H = this.wrap.clientHeight || 520;
    this.cv.width = this.W;
    this.cv.height = this.H;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020209);

    this.cam = new THREE.PerspectiveCamera(52, this.W / this.H, 0.1, 120);
    this.cam.position.set(5, 9, 22);
    this.cam.lookAt(5, 9, 0);

    this.rdr = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    this.scene.add(new THREE.AmbientLight(0x112233, 0.7));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9);
    dl.position.set(8, 20, 15);
    this.scene.add(dl);
    this.glow = new THREE.PointLight(accentColor, 2, 28);
    this.glow.position.set(5, 9, 6);
    this.scene.add(this.glow);

    this._buildBorderGrid();

    this.grpBoard  = new THREE.Group(); this.scene.add(this.grpBoard);
    this.grpActive = new THREE.Group(); this.scene.add(this.grpActive);
    this.grpGhost  = new THREE.Group(); this.scene.add(this.grpGhost);
    this.grpFX     = new THREE.Group(); this.scene.add(this.grpFX);

    this.board = null;
    this.active = null;
    this.next = null;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.running = false;
    this.dead = false;
    this.raf = null;
    this.dropTimer = 0;
    this.dropInterval = 800;
    this.particles = [];
    this.lastT = 0;

    this.resize();
    this.rdr.render(this.scene, this.cam);
  }

  _buildBorderGrid() {
    const bMat = new THREE.LineBasicMaterial({ color: this.accentColor, transparent: true, opacity: 0.55 });
    const bPts = [
      new THREE.Vector3(-0.5, -0.5, 0),
      new THREE.Vector3(this.TC - 0.5, -0.5, 0),
      new THREE.Vector3(this.TC - 0.5, this.TR - 0.5, 0),
      new THREE.Vector3(-0.5, this.TR - 0.5, 0),
      new THREE.Vector3(-0.5, -0.5, 0),
    ];
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bPts), bMat));

    const gMat = new THREE.LineBasicMaterial({ color: 0x003322, transparent: true, opacity: 0.22 });
    const gPts = [];
    for (let x = 0; x <= this.TC; x++) {
      gPts.push(new THREE.Vector3(x - 0.5, -0.5, 0));
      gPts.push(new THREE.Vector3(x - 0.5, this.TR - 0.5, 0));
    }
    for (let y = 0; y <= this.TR; y++) {
      gPts.push(new THREE.Vector3(-0.5, y - 0.5, 0));
      gPts.push(new THREE.Vector3(this.TC - 0.5, y - 0.5, 0));
    }
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gPts), gMat));
  }

  _makeMat(color, emissiveInt = 0.4) {
    return new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: emissiveInt,
      roughness: 0.25, metalness: 0.65,
    });
  }

  start() {
    this.board = Array.from({ length: this.TR }, () => Array(this.TC).fill(0));
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.dead = false;
    this.running = true;
    this.particles = [];
    this.dropTimer = 0;
    this.dropInterval = 800;

    clearGroup(this.grpBoard);
    clearGroup(this.grpActive);
    clearGroup(this.grpGhost);
    clearGroup(this.grpFX);

    this.next = this._randPiece();
    this._spawnPiece();

    if (this.raf) cancelAnimationFrame(this.raf);
    this.lastT = performance.now();
    this._loop(this.lastT);
  }

  _randPiece() {
    const SHAPES = [
      { s: [[1,1,1,1]],          c: 0x00eeff },
      { s: [[1,1],[1,1]],        c: 0xffee00 },
      { s: [[0,1,0],[1,1,1]],    c: 0xcc00ff },
      { s: [[0,1,1],[1,1,0]],    c: 0x00ff55 },
      { s: [[1,1,0],[0,1,1]],    c: 0xff2244 },
      { s: [[1,0,0],[1,1,1]],    c: 0x2255ff },
      { s: [[0,0,1],[1,1,1]],    c: 0xff8800 },
    ];
    const p = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    return { shape: p.s.map(r => [...r]), color: p.c, x: 3, y: -2 };
  }

  _rotateCW(m) {
    const R = m.length, C = m[0].length;
    const out = Array.from({ length: C }, () => Array(R).fill(0));
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) out[c][R - 1 - r] = m[r][c];
    return out;
  }

  _spawnPiece() {
    this.active = this.next;
    this.active.x = Math.floor((this.TC - this.active.shape[0].length) / 2);
    this.active.y = -1;
    this.next = this._randPiece();
    if (!this._valid(this.active.shape, this.active.x, this.active.y)) this._die();
  }

  _valid(shape, px, py) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const bx = px + c, by = py + r;
        if (bx < 0 || bx >= this.TC || by >= this.TR) return false;
        if (by >= 0 && this.board[by][bx]) return false;
      }
    }
    return true;
  }

  _ghostY() {
    let gy = this.active.y;
    while (this._valid(this.active.shape, this.active.x, gy + 1)) gy++;
    return gy;
  }

  move(dx) {
    if (!this.running || this.dead) return;
    if (this._valid(this.active.shape, this.active.x + dx, this.active.y)) {
      this.active.x += dx;
      sndMove();
    }
  }

  rotate() {
    if (!this.running || this.dead) return;
    const rot = this._rotateCW(this.active.shape);
    for (const k of [0, -1, 1, -2, 2]) {
      if (this._valid(rot, this.active.x + k, this.active.y)) {
        this.active.shape = rot;
        this.active.x += k;
        sndRotate();
        return;
      }
    }
  }

  softDrop() {
    if (!this.running || this.dead) return;
    if (this._valid(this.active.shape, this.active.x, this.active.y + 1)) {
      this.active.y++;
      this.score++;
      this.dropTimer = 0;
    } else this._lock();
  }

  hardDrop() {
    if (!this.running || this.dead) return;
    const gy = this._ghostY();
    this.score += (gy - this.active.y) * 2;
    this.active.y = gy;
    this._lock();
  }

  _lock() {
    if (this.dead) return;
    const { shape, x, y, color } = this.active;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        if (y + r < 0) { this._die(); return; }
        this.board[y + r][x + c] = color;
      }
    }
    sndLock();
    const cleared = this._clearLines();
    if (cleared > 0) {
      const pts = [0, 100, 300, 500, 800][cleared] * this.level;
      this.score += pts;
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10) + 1;
      this.dropInterval = Math.max(80, 800 - (this.level - 1) * 70);
      sndClear(cleared);
    }
    this._rebuildBoard();
    this._spawnPiece();
  }

  _clearLines() {
    let count = 0;
    for (let r = this.TR - 1; r >= 0; r--) {
      if (this.board[r].every(v => v !== 0)) {
        this._spawnClearFX(r);
        this.board.splice(r, 1);
        this.board.unshift(Array(this.TC).fill(0));
        count++; r++;
      }
    }
    return count;
  }

  _spawnClearFX(row) {
    for (let c = 0; c < this.TC; c++) {
      const col = this.board[row][c] || 0x00ffcc;
      for (let i = 0; i < 4; i++) {
        const g = new THREE.BoxGeometry(0.12, 0.12, 0.12);
        const m = new THREE.MeshBasicMaterial({ color: col, transparent: true });
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(c, this.TR - 1 - row, 0.5);
        const vel = {
          x: (Math.random() - 0.5) * 0.25,
          y: Math.random() * 0.35 + 0.08,
          z: Math.random() * 0.2
        };
        this.grpFX.add(mesh);
        this.particles.push({ mesh, vel, life: 1.0 });
      }
    }
  }

  _rebuildBoard() {
    clearGroup(this.grpBoard);
    for (let r = 0; r < this.TR; r++) {
      for (let c = 0; c < this.TC; c++) {
        const color = this.board[r][c];
        if (!color) continue;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.91, 0.91, 0.91),
          this._makeMat(color, 0.28)
        );
        mesh.position.set(c, this.TR - 1 - r, 0);
        this.grpBoard.add(mesh);
      }
    }
  }

  _rebuildActive() {
    clearGroup(this.grpActive);
    clearGroup(this.grpGhost);
    if (!this.active || !this.running || this.dead) return;
    const { shape, x, y, color } = this.active;
    const gy = this._ghostY();
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const am = new THREE.Mesh(
          new THREE.BoxGeometry(0.91, 0.91, 0.91),
          this._makeMat(color, 0.75)
        );
        am.position.set(x + c, this.TR - 1 - (y + r), 0.35);
        this.grpActive.add(am);

        const gm = new THREE.Mesh(
          new THREE.BoxGeometry(0.87, 0.87, 0.87),
          new THREE.MeshBasicMaterial({
            color, wireframe: true, transparent: true, opacity: 0.22
          })
        );
        gm.position.set(x + c, this.TR - 1 - (gy + r), 0);
        this.grpGhost.add(gm);
      }
    }
  }

  _die() {
    this.dead = true;
    this.running = false;
    sndOver();
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  }

  handleInput(code) {
    if (this.dead) return;
    const actions = {
      'moveLeft':  () => this.move(-1),
      'moveRight': () => this.move(1),
      'rotate':    () => this.rotate(),
      'softDrop':  () => this.softDrop(),
      'hardDrop':  () => this.hardDrop(),
    };
    if (actions[code]) actions[code]();
  }

  _loop(t) {
    if (!this.running && this.dead) return;
    const dt = Math.min(t - this.lastT, 50);
    this.lastT = t;
    if (this.dead) return;

    this.dropTimer += dt;
    if (this.dropTimer >= this.dropInterval) {
      this.dropTimer = 0;
      if (this._valid(this.active.shape, this.active.x, this.active.y + 1)) this.active.y++;
      else this._lock();
      if (this.dead) return;
    }

    this.particles = this.particles.filter(p => {
      p.life -= 0.025;
      p.vel.y -= 0.012;
      p.mesh.position.x += p.vel.x;
      p.mesh.position.y += p.vel.y;
      p.mesh.position.z += p.vel.z;
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) {
        this.grpFX.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.glow.intensity = 1.4 + Math.sin(t * 0.004) * 0.35;
    this._rebuildActive();
    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  resize() {
    const W = this.wrap.clientWidth || 400;
    const H = this.wrap.clientHeight || 520;
    this.W = W; this.H = H;
    this.cv.width = W; this.cv.height = H;
    this.cam.aspect = W / H;
    this.cam.updateProjectionMatrix();
    this.rdr.setSize(W, H);
  }

  dispose() {
    this.running = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    clearGroup(this.grpBoard);
    clearGroup(this.grpActive);
    clearGroup(this.grpGhost);
    clearGroup(this.grpFX);
    if (this.rdr) this.rdr.dispose();
  }
}

let tetrisDuelP1 = null;
let tetrisDuelP2 = null;

function startTetrisMultiplayer() {
  // Hide overlays
  document.getElementById('tetris-overlay').style.display = 'none';
  document.getElementById('tetris-duel-overlay').style.display = 'none';

  // Show duel layout, hide single
  document.getElementById('t-hud-single').style.display = 'none';
  document.getElementById('t-hud-duel').style.display = 'flex';
  document.getElementById('t-canvas-single').style.display = 'none';
  document.getElementById('t-canvas-duel').style.display = 'flex';

  // Update hint
  document.querySelector('#panel-tetris .hint').textContent =
    'P1: A/D/W/S/SPACE &nbsp;|&nbsp; P2: ← → ↑ ↓ / NUMPAD0 &nbsp;|&nbsp; FIRST TO DIE LOSES!';

  tetrisDuelActive = true;

  // Dispose old 3D instances (canvas gets reused, need fresh WebGL context)
  if (tetrisDuelP1) { tetrisDuelP1.dispose(); tetrisDuelP1 = null; }
  if (tetrisDuelP2) { tetrisDuelP2.dispose(); tetrisDuelP2 = null; }

  // Create 3D players — wrapper is already visible so resize() picks up correct size
  tetrisDuelP1 = new TetrisDuel3D('tetris-p1-canvas', 'P1', 0x00ffcc);
  tetrisDuelP2 = new TetrisDuel3D('tetris-p2-canvas', 'P2', 0xffee00);

  tetrisDuelP1.start();
  tetrisDuelP2.start();

  // Reset death overlays
  document.getElementById('tetris-p1-overlay').style.display = 'none';
  document.getElementById('tetris-p2-overlay').style.display = 'none';

  // Update scores periodically and detect death
  if (tetrisDuelScoreInterval) clearInterval(tetrisDuelScoreInterval);
  tetrisDuelScoreInterval = setInterval(() => {
    if (!tetrisDuelActive) { clearInterval(tetrisDuelScoreInterval); return; }

    document.getElementById('td-p1-score').textContent = tetrisDuelP1 ? tetrisDuelP1.score : 0;
    document.getElementById('td-p1-lines').textContent = tetrisDuelP1 ? tetrisDuelP1.lines : 0;
    document.getElementById('td-p2-score').textContent = tetrisDuelP2 ? tetrisDuelP2.score : 0;
    document.getElementById('td-p2-lines').textContent = tetrisDuelP2 ? tetrisDuelP2.lines : 0;
    document.getElementById('td-p1-lines-inline').textContent = tetrisDuelP1 ? tetrisDuelP1.lines : 0;
    document.getElementById('td-p2-lines-inline').textContent = tetrisDuelP2 ? tetrisDuelP2.lines : 0;

    const p1Dead = tetrisDuelP1 && tetrisDuelP1.dead;
    const p2Dead = tetrisDuelP2 && tetrisDuelP2.dead;

    if (p1Dead) document.getElementById('tetris-p1-overlay').style.display = 'flex';
    if (p2Dead) document.getElementById('tetris-p2-overlay').style.display = 'flex';

    if ((p1Dead || p2Dead) && tetrisDuelActive) {
      const p1Score = tetrisDuelP1 ? tetrisDuelP1.score : 0;
      const p2Score = tetrisDuelP2 ? tetrisDuelP2.score : 0;
      const p1Lines = tetrisDuelP1 ? tetrisDuelP1.lines : 0;
      const p2Lines = tetrisDuelP2 ? tetrisDuelP2.lines : 0;

      setTimeout(() => {
        if (!tetrisDuelActive) return;
        tetrisDuelActive = false;
        clearInterval(tetrisDuelScoreInterval);

        let winner = '';
        if (p1Dead && p2Dead) {
          winner = p1Lines > p2Lines ? '🏆 PLAYER 1 WINS!' :
                   p2Lines > p1Lines ? '🏆 PLAYER 2 WINS!' : '🤝 DRAW!';
        } else if (p1Dead) {
          winner = '🏆 PLAYER 2 WINS!';
        } else {
          winner = '🏆 PLAYER 1 WINS!';
        }

        const ov = document.getElementById('tetris-duel-overlay');
        ov.style.display = 'flex';
        document.getElementById('td-result-title').textContent = 'DUEL OVER';
        document.getElementById('td-result-text').textContent = winner;
        document.getElementById('td-result-scores').textContent =
          `P1: ${p1Score} (${p1Lines}L)  |  P2: ${p2Score} (${p2Lines}L)`;

        const best = Math.max(p1Score, p2Score);
        const curBest = parseInt(localStorage.getItem('tBest') || '0');
        if (best > curBest) {
          localStorage.setItem('tBest', best);
          syncScore('tetris', best);
        }
      }, 800);
    }
  }, 100);
}

let tetrisDuelScoreInterval = null;

// Handle input router for duel mode
function handleDuelKey(e) {
  if (!tetrisDuelActive || !currentTab === 'tetris') return;
  
  // P1: WASD + Space + C
  const p1Map = {
    'KeyA': 'moveLeft', 'KeyD': 'moveRight',
    'KeyW': 'rotate',
    'KeyS': 'softDrop',
    'Space': 'hardDrop',
    'KeyC': 'hold',
  };
  
  // P2: Arrows + Numpad 0/1
  const p2Map = {
    'ArrowLeft': 'moveLeft', 'ArrowRight': 'moveRight',
    'ArrowUp': 'rotate',
    'ArrowDown': 'softDrop',
    'Numpad0': 'hardDrop',
    'Numpad1': 'hold',
  };
  
  const p1Action = p1Map[e.code];
  const p2Action = p2Map[e.code];
  
  if (p1Action) {
    e.preventDefault();
    if (tetrisDuelP1 && !tetrisDuelP1.dead) tetrisDuelP1.handleInput(p1Action);
  }
  if (p2Action) {
    e.preventDefault();
    if (tetrisDuelP2 && !tetrisDuelP2.dead) tetrisDuelP2.handleInput(p2Action);
  }
}

// ============================================================
//  GLOBAL TETRIS (ONLINE MULTIPLAYER VIA FIREBASE)
// ============================================================
// Each player plays on their own board simultaneously.
// Winner is determined by lines cleared when someone dies.

let globalTetrisActive = false;
let globalTetrisUnsub = null;
let globalTetrisStateRef = null;
let globalTetrisPingTimer = null;
let globalTetrisPlayerId = null;

async function startTetrisGlobalMultiplayer() {
  try { await ensureAuth(); }
  catch (e) { alert('❌ Онлайн сейчас недоступен. Попробуйте позже.'); return; }
  
  document.getElementById('tetris-overlay').style.display='none';
  
  const ov = document.getElementById('tetris-overlay');
  ov.style.display = 'flex';
  ov.innerHTML = `<h2>SEARCHING...</h2>
    <div class="subtitle">CONNECTING TO GLOBAL SERVER</div>
    <div class="subtitle" id="gt-status" style="color:var(--cyan);">WAITING FOR OPPONENT...</div>
    <div class="subtitle" style="color:var(--dim);font-size:.6rem;" id="gt-game-id"></div>
    <button class="start-btn" data-act="cancelGlobalTetris" style="border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ CANCEL ]</button>`;
  
  try {
    await initGlobalTetrisSession();
  } catch (e) {
    console.error('Global tetris error:', e);
    ov.innerHTML = `<h2>CONNECTION ERROR</h2>
      <div class="subtitle">${escHtml(e.message || 'Failed to connect')}</div>
      <button class="start-btn" data-act="startTetrisGlobalMultiplayer">[ RETRY ]</button>
      <button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
  }
}

function cancelGlobalTetris() {
  if (globalTetrisUnsub) { globalTetrisUnsub(); globalTetrisUnsub = null; }
  if (globalTetrisPingTimer) { clearInterval(globalTetrisPingTimer); globalTetrisPingTimer = null; }
  if (globalTetrisStateRef) {
    globalTetrisStateRef.delete().catch(() => {});
    globalTetrisStateRef = null;
  }
  globalTetrisActive = false;
  globalTetrisPlayerId = null;
  document.getElementById('tetris-overlay').style.display = 'none';
  if (tetrisGame) { tetrisGame.running = false; if (tetrisGame.raf) cancelAnimationFrame(tetrisGame.raf); }
}

async function initGlobalTetrisSession() {
  const uid = fbAuth.currentUser.uid;
  const name = getNick();
  const lobbiesRef = fbDb.collection('tetris_global');
  
  const openLobby = await findOpenLobby(lobbiesRef.id, uid);
  
  let sessionRef;
  
  if (openLobby) {
    // Join as P2
    sessionRef = openLobby.ref;
    globalTetrisPlayerId = 'p2';
    
    await sessionRef.update({
      status: 'playing',
      p2: { uid, name, score: 0, lines: 0, level: 1 },
      startTime: firebase.firestore.FieldValue.serverTimestamp(),
    });
    
    document.getElementById('gt-status').textContent = 'OPPONENT FOUND! STARTING...';
    document.getElementById('gt-game-id').textContent = '';
    
    setTimeout(() => {
      document.getElementById('tetris-overlay').style.display = 'none';
      startGlobalTetrisGame(sessionRef, false);
    }, 800);
  } else {
    // Create lobby as P1
    globalTetrisPlayerId = 'p1';
    
    sessionRef = await lobbiesRef.add({
      status: 'waiting',
      p1: { uid, name, score: 0, lines: 0, level: 1 },
      p2: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ping: Date.now(),
    });
    
    globalTetrisStateRef = sessionRef;
    document.getElementById('gt-game-id').textContent = 'ROOM: ' + sessionRef.id.slice(0, 8);
    
    globalTetrisUnsub = sessionRef.onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.p2 && data.status === 'playing' && !globalTetrisActive) {
        document.getElementById('gt-status').textContent = 'OPPONENT JOINED! STARTING...';
        setTimeout(() => {
          document.getElementById('tetris-overlay').style.display = 'none';
          startGlobalTetrisGame(sessionRef, true);
        }, 800);
      }
    });
    
    globalTetrisPingTimer = setInterval(async () => {
      try { if (sessionRef) await sessionRef.update({ ping: Date.now() }); } catch(e) {}
    }, 3000);
  }
}

function startGlobalTetrisGame(sessionRef, isHost) {
  globalTetrisActive = true;
  globalTetrisStateRef = sessionRef;
  
  // Init game (single player mode but with sync)
  document.getElementById('tetris-overlay').style.display = 'none';
  if (!tetrisGame) tetrisGame = new Tetris3D();
  tetrisGame.start();
  
  // Override: mark as global
  tetrisGame.isGlobalTetris = true;
  tetrisGame.globalSessionRef = sessionRef;
  tetrisGame.globalPlayerId = globalTetrisPlayerId;
  tetrisGame.globalOtherLines = 0;
  tetrisGame.globalOtherLevel = 1;
  tetrisGame.globalOtherScore = 0;
  
  document.querySelector('#panel-tetris .hint').textContent =
    '← → MOVE &nbsp;|&nbsp; ↑ / Z ROTATE &nbsp;|&nbsp; ↓ SOFT DROP &nbsp;|&nbsp; SPACE HARD DROP &nbsp;|&nbsp; C HOLD &nbsp;|&nbsp; GLOBAL VS';
  
  // Show opponent info in HUD
  let oppEl = document.getElementById('t-opponent-info');
  if (!oppEl) {
    oppEl = document.createElement('span');
    oppEl.id = 't-opponent-info';
    oppEl.style.color = 'var(--pink)';
    document.querySelector('#panel-tetris .hud-right').prepend(oppEl);
  }
  oppEl.innerHTML = 'OPP: <b id="t-opp-lines">0</b>L';
  
  // ── THROTTLED WRITE: send score every 500ms ──
  let lastWrite = 0;
  const WRITE_INTERVAL = 500;
  
  function tryWriteState(now) {
    if (now - lastWrite < WRITE_INTERVAL) return;
    lastWrite = now;
    const pk = globalTetrisPlayerId;
    sessionRef.update({
      [`${pk}.score`]: tetrisGame.score,
      [`${pk}.lines`]: tetrisGame.lines,
      [`${pk}.level`]: tetrisGame.level,
      [`${pk}.connected`]: true,
      [`${pk}.lastUpdate`]: Date.now(),
    }).catch(() => {});
  }
  
  // Listen for opponent updates
  if (globalTetrisUnsub) globalTetrisUnsub();
  globalTetrisUnsub = sessionRef.onSnapshot(snap => {
    if (!snap.exists || !globalTetrisActive) return;
    const data = snap.data();
    if (!data) return;
    
    const rk = globalTetrisPlayerId === 'p1' ? 'p2' : 'p1';
    const remote = data[rk];
    const mk = globalTetrisPlayerId;
    
    // Check if opponent died
    const oppDead = data.status === 'ended' ||
      (remote && remote.connected === false) ||
      (data.status === 'playing' && mk && data[mk] && !remote);
    
    if (oppDead && globalTetrisActive) {
      endGlobalTetris('🎉 YOU WIN! OPPONENT ELIMINATED');
      return;
    }
    
    if (remote && remote.connected !== false) {
      tetrisGame.globalOtherLines = remote.lines || 0;
      tetrisGame.globalOtherLevel = remote.level || 1;
      tetrisGame.globalOtherScore = remote.score || 0;
      const el = document.getElementById('t-opp-lines');
      if (el) el.textContent = remote.lines || 0;
    }
  });
  
  // Override _loop to add throttled write
  tetrisGame._originalLoop = tetrisGame._loop;
  tetrisGame._loop = function(t) {
    this._originalLoop.call(this, t);
    const now = performance.now();
    tryWriteState(now);
    // If we died, notify opponent
    if (!this.running && globalTetrisActive) {
      endGlobalTetris(null);
    }
  };
  
  // Override game over
  tetrisGame._originalGameOver = tetrisGame._gameOver;
  tetrisGame._gameOver = function() {
    // Write death immediately
    const pk = globalTetrisPlayerId;
    sessionRef.update({
      status: 'ended',
      endedAt: Date.now(),
      [`${pk}.connected`]: false,
      [`${pk}.score`]: this.score,
      [`${pk}.lines`]: this.lines,
    }).catch(() => {});
    endGlobalTetris(null);
    this._originalGameOver.call(this);
  };
}

async function endGlobalTetris(reason) {
  if (!globalTetrisActive) return;
  globalTetrisActive = false;
  
  if (globalTetrisUnsub) { globalTetrisUnsub(); globalTetrisUnsub = null; }
  if (globalTetrisPingTimer) { clearInterval(globalTetrisPingTimer); globalTetrisPingTimer = null; }
  
  // Stop game
  if (tetrisGame) {
    tetrisGame.running = false;
    if (tetrisGame.raf) { cancelAnimationFrame(tetrisGame.raf); tetrisGame.raf = null; }
  }
  
  // Clean up Firestore
  if (globalTetrisStateRef) {
    try {
      await globalTetrisStateRef.update({
        status: 'ended',
        endedAt: Date.now(),
        [`${globalTetrisPlayerId}.connected`]: false,
      }).catch(() => {});
      setTimeout(() => {
        globalTetrisStateRef.delete().catch(() => {});
        globalTetrisStateRef = null;
      }, 2000);
    } catch(e) {}
  }
  
  // Clean up HUD
  const oppEl = document.getElementById('t-opponent-info');
  if (oppEl) oppEl.remove();
  
  if (reason) {
    const ov = document.getElementById('tetris-overlay');
    ov.style.display = 'flex';
    ov.innerHTML = `<h2>VICTORY!</h2>
      <div class="score-big">${escHtml(reason)}</div>
      <div class="subtitle">YOU: ${tetrisGame ? tetrisGame.score.toLocaleString() : 0} | OPP: ${tetrisGame ? tetrisGame.globalOtherScore.toLocaleString() : 0}</div>
      <button class="start-btn" data-act="startTetrisGlobalMultiplayer">[ PLAY AGAIN ]</button>
      <button class="start-btn" data-act="startTetris">[ SINGLE PLAYER ]</button>
      <button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
  }
  
  globalTetrisPlayerId = null;
}

// ============================================================
//  PARKOUR RUNNER
// ============================================================
class ParkourRunner {
  constructor() {
    this.cv = document.getElementById('runner-canvas');
    this.wrap = this.cv.parentElement;
    this.W = this.wrap.clientWidth; this.H = this.wrap.clientHeight||560;
    this.cv.width = this.W; this.cv.height = this.H;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010108);
    this.scene.fog = new THREE.FogExp2(0x010108, 0.035);

    this.cam = new THREE.PerspectiveCamera(65, this.W/this.H, 0.1, 120);

    this.rdr = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.add(new THREE.AmbientLight(0x111133, 0.55));
    const dl = new THREE.DirectionalLight(0x4466ff, 0.7);
    dl.position.set(0, 12, 8); this.scene.add(dl);
    this.playerLight = new THREE.PointLight(0x00ffcc, 2.5, 10);
    this.scene.add(this.playerLight);

    this._addStars();

    this.playerGroup = new THREE.Group(); this.scene.add(this.playerGroup);
    const pGeo = new THREE.BoxGeometry(0.75, 0.75, 0.75);
    const pMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.6 });
    this.playerMesh = new THREE.Mesh(pGeo, pMat);
    this.playerGroup.add(this.playerMesh);
    const pEdge = new THREE.LineSegments(new THREE.EdgesGeometry(pGeo), new THREE.LineBasicMaterial({ color: 0x00ffcc }));
    this.playerGroup.add(pEdge);

    this.platGroup = new THREE.Group(); this.scene.add(this.platGroup);
    this.platforms = [];

    this.trailGroup = new THREE.Group(); this.scene.add(this.trailGroup);
    this.trailParts = [];

    this.running = false; this.raf = null; this.lastT = 0;
    this.bestDist = parseInt(localStorage.getItem('rBest')||'0');
    document.getElementById('r-best').textContent = this.bestDist;

    this.resize();
    this.rdr.render(this.scene, this.cam);
  }

  _addStars() {
    const pts = [];
    for (let i=0; i<600; i++) pts.push(new THREE.Vector3(
      (Math.random()-.5)*200, (Math.random()-.5)*80, -(Math.random()*80+5)
    ));
    const sGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const sMat = new THREE.PointsMaterial({ color: 0x4488cc, size: 0.15, transparent: true, opacity: 0.7 });
    this.scene.add(new THREE.Points(sGeo, sMat));
  }

  _addPlat(x, y, z, w) {
    const h = 0.4, d = 2.5 + Math.random()*2.5;
    const geo = new THREE.BoxGeometry(w, h, d);
    const cols = [0x0044ff, 0xff0066, 0x00ffcc, 0xffaa00, 0xcc00ff, 0x00aaff];
    const col = cols[Math.floor(Math.random()*cols.length)];
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.12, roughness: 0.35, metalness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x+w/2, y-h/2, z);
    const edgeMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 });
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    this.platGroup.add(mesh);
    this.platforms.push({ mesh, x, xEnd: x+w, y, z, w, d });
    return x+w;
  }

  _genPlatforms() {
    clearGroup(this.platGroup); this.platforms = [];
    let x = -1;
    for (let i=0; i<22; i++) {
      const w = 2.5+Math.random()*3;
      const z = (Math.random()-.5)*3;
      const y = i===0 ? 0 : (Math.random()-.35)*1.8;
      x = this._addPlat(x, y, z, w);
      x += Math.random()*1.8 + 0.8;
    }
    this.nextX = x;
  }

  start() {
    this.px = 1; this.py = 2; this.pz = 0;
    this.vy = 0; this.jumps = 2; this.onGnd = false;
    this.speed = 4.5; this.dist = 0; this.runTime = 0;
    this.running = true;
    clearGroup(this.trailGroup); this.trailParts = [];
    this._genPlatforms();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.lastT = performance.now(); this._loop(this.lastT);
  }

  jump() {
    if (!this.running) return;
    if (this.jumps > 0) { this.vy = 8.5; this.jumps--; sndJump(); }
  }

  _collide() {
    this.onGnd = false;
    const hs = 0.375;
    for (const p of this.platforms) {
      if (this.px+hs < p.x || this.px-hs > p.xEnd) continue;
      if (this.pz+hs < p.z-p.d/2 || this.pz-hs > p.z+p.d/2) continue;
      if (this.vy <= 0 && this.py-hs <= p.y+0.12 && this.py-hs >= p.y-0.6) {
        this.py = p.y+hs; this.vy = 0; this.onGnd = true; this.jumps = 2; return;
      }
    }
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min((t-this.lastT)/1000, 0.05); this.lastT = t;
    this.runTime += dt;
    this.speed = 4.5 + this.runTime*0.22;
    this.dist = Math.floor(this.px);

    this.px += this.speed * dt;
    this.vy -= 22 * dt;
    this.py += this.vy * dt;
    this._collide();

    if (this.py < -12) { this._endRun(); return; }

    while (this.nextX < this.px+50) {
      const w=2+Math.random()*3, z=(Math.random()-.5)*3.5, y=(Math.random()-.4)*2.2;
      this.nextX = this._addPlat(this.nextX, y, z, w);
      this.nextX += Math.random()*2+0.6;
    }
    this.platforms = this.platforms.filter(p => {
      if (p.xEnd < this.px-25) { this.platGroup.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); return false; }
      return true;
    });

    const tx = this.px-5, ty = this.py+5, tz = this.pz+14;
    this.cam.position.x += (tx-this.cam.position.x)*0.07;
    this.cam.position.y += (ty-this.cam.position.y)*0.06;
    this.cam.position.z += (tz-this.cam.position.z)*0.07;
    this.cam.lookAt(this.px+4, this.py, this.pz);

    this.playerGroup.position.set(this.px, this.py, this.pz);
    this.playerMesh.rotation.x += 3.5*dt;
    this.playerMesh.rotation.z += 1.2*dt;
    this.playerLight.position.set(this.px, this.py, this.pz);

    if (Math.random() < 0.35) {
      const g = new THREE.BoxGeometry(0.08,0.08,0.08);
      const m = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(g,m);
      mesh.position.set(this.px+(Math.random()-.5)*0.3, this.py+(Math.random()-.5)*0.3, this.pz);
      this.trailGroup.add(mesh); this.trailParts.push({ mesh, life: 1.0 });
    }
    this.trailParts = this.trailParts.filter(p => {
      p.life -= 0.05;
      p.mesh.material.opacity = p.life * 0.8;
      p.mesh.scale.setScalar(p.life);
      if (p.life <= 0) { this.trailGroup.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); return false; }
      return true;
    });

    document.getElementById('r-dist').textContent = this.dist;
    document.getElementById('r-speed').textContent = (this.speed/4.5).toFixed(1);
    document.getElementById('r-best').textContent = Math.max(this.bestDist, this.dist);

    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  _endRun() {
    this.running = false; sndDie();
    const isRec = this.dist > this.bestDist;
    if (isRec) {
      this.bestDist = this.dist;
      localStorage.setItem('rBest', this.bestDist);
      syncScore('runner', this.dist);
    }
    const ov = document.getElementById('runner-overlay');
    ov.innerHTML = `<h2>WIPEOUT</h2><div class="score-big">${this.dist}m</div>${isRec?'<div class="new-rec">▓ NEW RECORD ▓</div>':`<div class="subtitle">BEST: ${this.bestDist}m</div>`}<button class="start-btn" data-act="startRunner">[ TRY AGAIN ]</button><button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
    ov.style.display = 'flex';
  }

  resize() {
    const W=this.wrap.clientWidth, H=this.wrap.clientHeight||560;
    this.cv.width=W; this.cv.height=H;
    this.cam.aspect=W/H; this.cam.updateProjectionMatrix();
    this.rdr.setSize(W,H);
  }
}

function startRunner() {
  document.getElementById('runner-overlay').style.display = 'none';
  if (!runnerGame) runnerGame = new ParkourRunner();
  runnerGame.start();
}

// ============================================================
//  CYBER SNAKE (SINGLE + MULTIPLAYER CO-OP)
// ============================================================
const SG = 25;
const SC = 600/SG;

class CyberSnake {
  constructor() {
    this.cv = document.getElementById('snake-canvas');
    this.ctx = this.cv.getContext('2d');
    this.running = false; this.raf = null;
    this.high = parseInt(localStorage.getItem('sHigh')||'0');
    this.isMultiplayer = false;
    document.getElementById('s-high').textContent = this.high;
  }

  start(isMultiplayer = false) {
    this.isMultiplayer = isMultiplayer;
    // Snake 1 (P1: WASD)
    this.snake = [{x:12,y:12},{x:11,y:12},{x:10,y:12}];
    this.dir = {x:1,y:0}; this.ndir = {x:1,y:0};
    // Snake 2 (P2: Arrow keys) — only in multiplayer
    if (isMultiplayer) {
      this.snake2 = [{x:12,y:8},{x:11,y:8},{x:10,y:8}]; // start above player 1
      this.dir2 = {x:1,y:0}; this.ndir2 = {x:1,y:0};
      this.score2 = 0;
      document.getElementById('s2-score').textContent = '0';
      document.getElementById('s-p2-score').style.display = '';
      document.querySelector('#panel-snake .hint').textContent =
        'P1: WASD — MOVE &nbsp;|&nbsp; P2: ← → ↑ ↓ — MOVE &nbsp;|&nbsp; CO-OP: SHARE THE GRID! &nbsp;|&nbsp; ESC BACK';
    } else {
      this.snake2 = [];
      this.score2 = 0;
      document.getElementById('s-p2-score').style.display = 'none';
    }
    this.score = 0; this.mult = 1; this.multT = 0;
    this.ghostMode = false; this.ghostT = 0;
    this.moveIv = 130; this.moveT = 0;
    this.foods = []; this.powerups = []; this.parts = [];
    this.running = true;
    this._spawnFood(); this._spawnFood();
    if (isMultiplayer) { this._spawnFood(); this._spawnFood(); } // more food for 2 players
    document.getElementById('s-score').textContent = '0';
    document.getElementById('s-multi').textContent = '×1';
    document.getElementById('s-effect').textContent = '';
    if (this.raf) cancelAnimationFrame(this.raf);
    this.lastT = performance.now(); this._loop(this.lastT);
  }

  _occ(x,y,skipFood=false) {
    if (this.snake.some(s=>s.x===x&&s.y===y)) return true;
    if (this.snake2.some(s=>s.x===x&&s.y===y)) return true;
    if (!skipFood && this.foods.some(f=>f.x===x&&f.y===y)) return true;
    return false;
  }

  _spawnFood() {
    for (let a=0;a<200;a++) {
      const x=Math.floor(Math.random()*SG), y=Math.floor(Math.random()*SG);
      if (!this._occ(x,y)) { this.foods.push({x,y,pulse:Math.random()*Math.PI*2}); return; }
    }
  }

  _spawnPU() {
    const types=['speed','ghost','multi'];
    const type=types[Math.floor(Math.random()*types.length)];
    for (let a=0;a<200;a++) {
      const x=Math.floor(Math.random()*SG), y=Math.floor(Math.random()*SG);
      if (!this._occ(x,y,true)) { this.powerups.push({x,y,type,life:400,pulse:0}); return; }
    }
  }

  _loop(t) {
    if (!this.running) return;
    const dt = t - this.lastT; this.lastT = t;
    this.moveT += dt;

    if (this.ghostMode) { this.ghostT -= dt; if (this.ghostT<=0) { this.ghostMode=false; document.getElementById('s-effect').textContent=''; } }
    if (this.mult > 1)  { this.multT -= dt; if (this.multT<=0) { this.mult=1; document.getElementById('s-multi').textContent='×1'; } }

    if (Math.random()<0.001 && this.powerups.length<2) this._spawnPU();
    this.powerups = this.powerups.filter(p=>{ p.life--; p.pulse+=0.15; return p.life>0; });
    this.foods.forEach(f=>f.pulse+=0.1);
    this.parts = this.parts.filter(p=>{ p.life-=0.035; p.x+=p.vx; p.y+=p.vy; return p.life>0; });

    if (this.moveT >= this.moveIv) { this.moveT -= this.moveIv; this._tick(); }

    this._draw();
    this.raf = requestAnimationFrame(tt=>this._loop(tt));
  }

  _tick() {
    this.dir = this.ndir;
    const head = {
      x:(this.snake[0].x+this.dir.x+SG)%SG,
      y:(this.snake[0].y+this.dir.y+SG)%SG,
    };
    // Self-collision P1
    if (!this.ghostMode && this.snake.some((s,i)=>i>0&&s.x===head.x&&s.y===head.y)) { this._end(); return; }
    // Cross-collision with P2's body
    if (!this.ghostMode && this.snake2.length > 0 && this.snake2.some((s,i)=>i>0&&s.x===head.x&&s.y===head.y)) { this._end(); return; }
    this.snake.unshift(head);

    const fi = this.foods.findIndex(f=>f.x===head.x&&f.y===head.y);
    if (fi>=0) {
      this.foods.splice(fi,1);
      this.score += 10*this.mult;
      document.getElementById('s-score').textContent = this.score;
      this._burst(head.x, head.y, 0x00ff88);
      sndEat(); this._spawnFood();
    } else { this.snake.pop(); }

    // Handle power-ups for P1
    const pi = this.powerups.findIndex(p=>p.x===head.x&&p.y===head.y);
    if (pi>=0) {
      const pu = this.powerups[pi]; this.powerups.splice(pi,1);
      sndPower(); this._burst(head.x, head.y, 0xff00ff);
      if (pu.type==='speed') {
        this.moveIv = Math.max(50, this.moveIv-25);
        document.getElementById('s-effect').textContent = 'OVERDRIVE';
        document.getElementById('s-effect').className = 'status-warn';
        setTimeout(()=>{ this.moveIv=Math.min(130,this.moveIv+25); if(this.ghostMode===false) document.getElementById('s-effect').textContent=''; },4500);
      } else if (pu.type==='ghost') {
        this.ghostMode=true; this.ghostT=5500;
        document.getElementById('s-effect').textContent = 'GHOST_MODE';
        document.getElementById('s-effect').className = 'status-active';
      } else {
        this.mult=3; this.multT=9000;
        document.getElementById('s-multi').textContent='×3';
        document.getElementById('s-effect').textContent = 'MULTIPLIER×3';
        document.getElementById('s-effect').className = 'status-warn';
      }
    }

    // ====== PLAYER 2 MOVEMENT ======
    if (this.snake2.length > 0) {
      this.dir2 = this.ndir2;
      const head2 = {
        x:(this.snake2[0].x+this.dir2.x+SG)%SG,
        y:(this.snake2[0].y+this.dir2.y+SG)%SG,
      };
      // Self-collision P2
      if (!this.ghostMode && this.snake2.some((s,i)=>i>0&&s.x===head2.x&&s.y===head2.y)) { this._end(); return; }
      // Cross-collision with P1's body
      if (!this.ghostMode && this.snake.some((s,i)=>i>0&&s.x===head2.x&&s.y===head2.y)) { this._end(); return; }
      // Head-on collision (P1 head -> P2 head or vice versa)
      if (head.x === head2.x && head.y === head2.y) { this._end(); return; }
      
      this.snake2.unshift(head2);

      const fi2 = this.foods.findIndex(f=>f.x===head2.x&&f.y===head2.y);
      if (fi2>=0) {
        this.foods.splice(fi2,1);
        this.score2 += 10;
        document.getElementById('s2-score').textContent = this.score2;
        this._burst(head2.x, head2.y, 0xff00aa);
        sndEat(); this._spawnFood();
      } else { this.snake2.pop(); }
      
      // Power-ups for P2 (same pool)
      const pi2 = this.powerups.findIndex(p=>p.x===head2.x&&p.y===head2.y);
      if (pi2>=0) {
        const pu = this.powerups[pi2]; this.powerups.splice(pi2,1);
        sndPower(); this._burst(head2.x, head2.y, 0xff00aa);
      }
    }
  }

  _burst(gx, gy, color) {
    const cx=gx*SC+SC/2, cy=gy*SC+SC/2;
    const hex='#'+color.toString(16).padStart(6,'0');
    for (let i=0;i<10;i++) {
      const a=(Math.PI*2*i)/10;
      this.parts.push({ x:cx, y:cy, vx:Math.cos(a)*(Math.random()*3.5+1), vy:Math.sin(a)*(Math.random()*3.5+1), color:hex, life:1.0 });
    }
  }

  _draw() {
    const ctx=this.ctx, W=600, H=600;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#020209'; ctx.fillRect(0,0,W,H);

    ctx.strokeStyle='rgba(0,255,180,0.045)'; ctx.lineWidth=1;
    for (let i=0;i<=SG;i++) {
      ctx.beginPath(); ctx.moveTo(i*SC,0); ctx.lineTo(i*SC,H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i*SC); ctx.lineTo(W,i*SC); ctx.stroke();
    }

    if (this.ghostMode) { ctx.fillStyle='rgba(68,136,255,0.05)'; ctx.fillRect(0,0,W,H); }
    if (this.mult>1) { ctx.fillStyle='rgba(255,200,0,0.03)'; ctx.fillRect(0,0,W,H); }

    this.parts.forEach(p=>{
      ctx.globalAlpha=p.life*0.9;
      ctx.fillStyle=p.color;
      const s=p.life*5;
      ctx.fillRect(p.x-s/2,p.y-s/2,s,s);
    });
    ctx.globalAlpha=1;

    this.foods.forEach(f=>{
      const cx=f.x*SC+SC/2, cy=f.y*SC+SC/2;
      const pl=Math.sin(f.pulse)*0.35+0.65;
      ctx.shadowColor='#00ffcc'; ctx.shadowBlur=14*pl;
      ctx.fillStyle=`rgba(0,255,180,${0.7+pl*0.3})`;
      ctx.fillRect(cx-5,cy-5,10,10);
      ctx.shadowBlur=0;
    });

    const puC={speed:'#ff4400',ghost:'#3399ff',multi:'#ffaa00'};
    const puL={speed:'SPD',ghost:'GHO',multi:'MLT'};
    this.powerups.forEach(p=>{
      const cx=p.x*SC+SC/2, cy=p.y*SC+SC/2;
      const pl=Math.sin(p.pulse)*0.4+0.6;
      const col=puC[p.type];
      ctx.shadowColor=col; ctx.shadowBlur=16*pl;
      ctx.fillStyle=col;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(p.pulse*0.5+Math.PI/4);
      ctx.fillRect(-7,-7,14,14); ctx.restore();
      ctx.shadowBlur=0;
      ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='bold 7px Courier New'; ctx.textAlign='center';
      ctx.fillText(puL[p.type], cx, cy+SC-3);
    });

    // Draw P1 snake (cyan)
    this.snake.forEach((seg,i)=>{
      const t=i/this.snake.length;
      const cx=seg.x*SC, cy=seg.y*SC;
      if (this.ghostMode) { ctx.globalAlpha=0.45; ctx.fillStyle=`hsl(200,100%,${70-t*25}%)`; }
      else { ctx.globalAlpha=1; ctx.fillStyle=i===0?'#00ffcc':`hsl(${160-t*45},100%,${62-t*22}%)`; }
      if (i===0) { ctx.shadowColor='#00ffcc'; ctx.shadowBlur=14; }
      ctx.fillRect(cx+1,cy+1,SC-2,SC-2);
      if (i===0) { ctx.shadowBlur=0;
        ctx.fillStyle='#011a0f';
        ctx.fillRect(cx+SC*0.27,cy+SC*0.28,3,3);
        ctx.fillRect(cx+SC*0.62,cy+SC*0.28,3,3);
      }
      ctx.shadowBlur=0; ctx.globalAlpha=1;
    });

    // Draw P2 snake (magenta/purple) in multiplayer
    if (this.snake2 && this.snake2.length > 0) {
      this.snake2.forEach((seg,i)=>{
        const t=i/this.snake2.length;
        const cx=seg.x*SC, cy=seg.y*SC;
        ctx.globalAlpha=1;
        ctx.fillStyle=i===0?'#ff00aa':`hsl(${300-t*40},100%,${55-t*20}%)`;
        if (i===0) { ctx.shadowColor='#ff00aa'; ctx.shadowBlur=14; }
        ctx.fillRect(cx+1,cy+1,SC-2,SC-2);
        if (i===0) { ctx.shadowBlur=0;
          ctx.fillStyle='#2a001a';
          ctx.fillRect(cx+SC*0.27,cy+SC*0.28,3,3);
          ctx.fillRect(cx+SC*0.62,cy+SC*0.28,3,3);
        }
        ctx.shadowBlur=0; ctx.globalAlpha=1;
      });
    }
  }

  _end() {
    this.running = false; sndOver();
    const combinedScore = this.score + this.score2;
    if (combinedScore > this.high) {
      this.high=combinedScore;
      localStorage.setItem('sHigh',this.high);
      syncScore('snake', combinedScore);
      document.getElementById('s-high').textContent=this.high;
    }
    const ov=document.getElementById('snake-overlay');
    const isRec = combinedScore>=this.high && combinedScore>0;
    
    let modeLabel = '';
    let modeButtons = '';
    if (this.isMultiplayer) {
      modeLabel = `<div class="subtitle">P1: ${this.score} | P2: ${this.score2} | COMBINED: ${combinedScore}</div>`;
      modeButtons = `
        <button class="start-btn" data-act="startSnake">[ SINGLE PLAYER ]</button>
        <button class="start-btn mp-btn" data-act="startSnakeMultiplayer">[ CO-OP AGAIN ]</button>`;
    } else {
      modeLabel = `<div class="subtitle">SCORE: ${this.score}</div>`;
      modeButtons = `<button class="start-btn" data-act="startSnake">[ RECONNECT ]</button>`;
    }
    
    ov.innerHTML=`<h2>SIGNAL LOST</h2>
      <div class="score-big">${this.isMultiplayer ? combinedScore.toLocaleString() : this.score}</div>
      ${modeLabel}
      ${isRec?'<div class="new-rec">▓ NEW HIGH SCORE ▓</div>':''}
      ${modeButtons}
      <button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
    ov.style.display='flex';
  }

  handleKey(e) {
    if (!this.running) return;
    // P1: WASD
    const map={'ArrowUp':{x:0,y:-1},'KeyW':{x:0,y:-1},'ArrowDown':{x:0,y:1},'KeyS':{x:0,y:1},'ArrowLeft':{x:-1,y:0},'KeyA':{x:-1,y:0},'ArrowRight':{x:1,y:0},'KeyD':{x:1,y:0}};
    
    if (this.isMultiplayer) {
      // P2: Arrow keys separate from P1
      const p2Map = {'ArrowUp':{x:0,y:-1},'ArrowDown':{x:0,y:1},'ArrowLeft':{x:-1,y:0},'ArrowRight':{x:1,y:0}};
      // P1 keys: WASD
      const p1Map = {'KeyW':{x:0,y:-1},'KeyS':{x:0,y:1},'KeyA':{x:-1,y:0},'KeyD':{x:1,y:0}};
      
      const p1d = p1Map[e.code];
      if (p1d && !(p1d.x===-this.dir.x && p1d.y===-this.dir.y)) { this.ndir = p1d; e.preventDefault(); }
      
      const p2d = p2Map[e.code];
      if (p2d && this.snake2.length > 0 && !(p2d.x===-this.dir2.x && p2d.y===-this.dir2.y)) { this.ndir2 = p2d; e.preventDefault(); }
    } else {
      const d=map[e.code];
      if (d && !(d.x===-this.dir.x && d.y===-this.dir.y)) { this.ndir=d; e.preventDefault(); }
    }
  }
}

function startSnake() {
  document.getElementById('snake-overlay').style.display='none';
  if (!snakeGame) snakeGame=new CyberSnake();
  snakeGame.start(false);
}

function startSnakeMultiplayer() {
  document.getElementById('snake-overlay').style.display='none';
  if (!snakeGame) snakeGame=new CyberSnake();
  snakeGame.start(true);
}

// ============================================================
//  GLOBAL SNAKE (ONLINE MULTIPLAYER VIA FIREBASE)
// ============================================================
// Uses Firestore real-time listener. Player 1 creates/lobbies, Player 2 joins.

let globalSnakeActive = false;
let globalSnakeUnsub = null;
let globalSnakeStateRef = null;
let globalSnakePingTimer = null;
let globalSnakePlayerId = null; // 'p1' or 'p2'
let globalSnakeOtherConnected = false;

async function startSnakeGlobalMultiplayer() {
  try { await ensureAuth(); }
  catch (e) { alert('❌ Онлайн сейчас недоступен. Попробуйте позже.'); return; }
  
  document.getElementById('snake-overlay').style.display='none';
  
  // Show waiting overlay
  if (!snakeGame) snakeGame = new CyberSnake();
  const ov = document.getElementById('snake-overlay');
  ov.style.display = 'flex';
  ov.innerHTML = `<h2>SEARCHING...</h2>
    <div class="subtitle">CONNECTING TO GLOBAL SERVER</div>
    <div class="subtitle" id="gs-status" style="color:var(--cyan);">WAITING FOR OPPONENT...</div>
    <div class="subtitle" style="color:var(--dim);font-size:.6rem;" id="gs-game-id"></div>
    <button class="start-btn" data-act="cancelGlobalSnake" style="border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ CANCEL ]</button>`;
  
  try {
    await initGlobalSnakeSession();
  } catch (e) {
    console.error('Global snake error:', e);
    ov.innerHTML = `<h2>CONNECTION ERROR</h2>
      <div class="subtitle">${escHtml(e.message || 'Failed to connect')}</div>
      <button class="start-btn" data-act="startSnakeGlobalMultiplayer">[ RETRY ]</button>
      <button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
  }
}

function cancelGlobalSnake() {
  if (globalSnakeUnsub) { globalSnakeUnsub(); globalSnakeUnsub = null; }
  if (globalSnakePingTimer) { clearInterval(globalSnakePingTimer); globalSnakePingTimer = null; }
  if (globalSnakeStateRef) {
    globalSnakeStateRef.delete().catch(() => {});
    globalSnakeStateRef = null;
  }
  globalSnakeActive = false;
  globalSnakePlayerId = null;
  document.getElementById('snake-overlay').style.display = 'none';
  if (snakeGame) { snakeGame.running = false; if (snakeGame.raf) cancelAnimationFrame(snakeGame.raf); }
}

async function initGlobalSnakeSession() {
  const uid = fbAuth.currentUser.uid;
  const name = getNick();
  
  // Try to find an existing open lobby or create one
  const lobbiesRef = fbDb.collection('snake_global');
  
  // Look for an open lobby with only 1 player
  const openLobby = await findOpenLobby(lobbiesRef.id, uid);
  
  let sessionRef;
  let isHost = false;
  
  if (openLobby) {
    // Join existing lobby as P2
    sessionRef = openLobby.ref;
    isHost = false;
    globalSnakePlayerId = 'p2';
    
    await sessionRef.update({
      status: 'playing',
      p2: { uid, name, x: 12, y: 8, dir: {x:1,y:0}, score: 0 },
      startTime: firebase.firestore.FieldValue.serverTimestamp(),
    });
    
    document.getElementById('gs-status').textContent = 'OPPONENT FOUND! STARTING...';
    document.getElementById('gs-game-id').textContent = '';
    
    setTimeout(() => {
      document.getElementById('snake-overlay').style.display = 'none';
      startGlobalGame(sessionRef, false);
    }, 800);
  } else {
    // Create new lobby as P1 (host)
    isHost = true;
    globalSnakePlayerId = 'p1';
    
    sessionRef = await lobbiesRef.add({
      status: 'waiting',
      p1: { uid, name, x: 12, y: 12, dir: {x:1,y:0}, score: 0 },
      p2: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ping: Date.now(),
    });
    
    globalSnakeStateRef = sessionRef;
    
    document.getElementById('gs-game-id').textContent = 'ROOM: ' + sessionRef.id.slice(0, 8);
    
    // Listen for P2 joining
    globalSnakeUnsub = sessionRef.onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      
      if (data.p2 && data.status === 'playing' && !globalSnakeActive) {
        document.getElementById('gs-status').textContent = 'OPPONENT JOINED! STARTING...';
        setTimeout(() => {
          document.getElementById('snake-overlay').style.display = 'none';
          startGlobalGame(sessionRef, true);
        }, 800);
      }
    });
    
    // Cleanup stale lobbies
    globalSnakePingTimer = setInterval(async () => {
      try {
        if (sessionRef) {
          await sessionRef.update({ ping: Date.now() });
        }
      } catch(e) {}
    }, 3000);
  }
}

function startGlobalGame(sessionRef, isHost) {
  globalSnakeActive = true;
  globalSnakeStateRef = sessionRef;
  
  // Initialize game locally
  snakeGame.start(false);
  snakeGame.running = true;
  
  // Override to global mode
  snakeGame.isGlobal = true;
  
  // Set player specific state
  snakeGame.globalPlayerId = globalSnakePlayerId;
  snakeGame.globalSessionRef = sessionRef;
  snakeGame.globalOtherScore = 0;
  snakeGame.globalOtherSnake = [];
  snakeGame.globalOtherDir = {x:1,y:0};
  
  if (globalSnakePlayerId === 'p1') {
    snakeGame.snake = [{x:12,y:12},{x:11,y:12},{x:10,y:12}];
    snakeGame.dir = {x:1,y:0}; snakeGame.ndir = {x:1,y:0};
  } else {
    snakeGame.snake = [{x:12,y:8},{x:11,y:8},{x:10,y:8}];
    snakeGame.dir = {x:1,y:0}; snakeGame.ndir = {x:1,y:0};
  }
  
  // Show P2 score display
  document.getElementById('s2-score').textContent = '0';
  document.getElementById('s-p2-score').style.display = '';
  document.querySelector('#panel-snake .hint').textContent =
    'WASD — MOVE &nbsp;|&nbsp; GLOBAL MULTIPLAYER &nbsp;|&nbsp; ESC BACK';
  
  // ── THROTTLED WRITE: write to Firestore max every 400ms ──
  let lastWrite = 0;
  const WRITE_INTERVAL = 400;
  
  // ── THROTTLED READ: process remote snapshot max every 300ms ──
  let lastRemoteUpdate = 0;
  let pendingRemoteData = null;
  const REMOTE_INTERVAL = 300;
  
  // Listen for remote player updates — throttled processing
  if (globalSnakeUnsub) globalSnakeUnsub();
  globalSnakeUnsub = sessionRef.onSnapshot(snap => {
    if (!snap.exists || !globalSnakeActive) return;
    const data = snap.data();
    if (!data) return;
    
    const remoteKey = globalSnakePlayerId === 'p1' ? 'p2' : 'p1';
    const remote = data[remoteKey];
    const myKey = globalSnakePlayerId;
    
    // ── ОПРЕДЕЛЕНИЕ ПОБЕДЫ: соперник умер или отключился ──
    const opponentDead = data.status === 'ended' ||
      (remote && remote.connected === false) ||
      (data.status === 'playing' && myKey && data[myKey] && !remote);
    
    if (opponentDead && globalSnakeActive) {
      pendingRemoteData = null; // Очищаем — не рисуем мёртвую змейку
      // Показываем сообщение о победе
      endGlobalSnake('🎉 YOU WIN! OPPONENT ELIMINATED');
      return;
    }
    
    if (remote && remote.connected !== false) {
      // Throttle: store data, process later in game loop
      pendingRemoteData = {
        snake: remote.snake || [],
        score: remote.score || 0,
        dir: remote.dir || {x:1,y:0},
        lastUpdate: remote.lastUpdate || 0,
      };
    }
  });
  
  // ── THROTTLED WRITE FUNCTION ──
  function tryWriteSnapshot(now) {
    if (now - lastWrite < WRITE_INTERVAL) return;
    lastWrite = now;
    const myKey = globalSnakePlayerId;
    sessionRef.update({
      [`${myKey}.snake`]: snakeGame.snake,
      [`${myKey}.score`]: snakeGame.score,
      [`${myKey}.dir`]: snakeGame.dir,
      [`${myKey}.lastUpdate`]: Date.now(),
      [`${myKey}.connected`]: true,
    }).catch(() => {});
  }
  
  // ── IMMEDIATE WRITE ON DEATH ──
  // ── THROTTLED READ FUNCTION ──
  function tryApplyRemoteUpdate(now) {
    if (!pendingRemoteData) return;
    if (now - lastRemoteUpdate < REMOTE_INTERVAL) return;
    lastRemoteUpdate = now;
    
    const remote = pendingRemoteData;
    pendingRemoteData = null;
    
    if (remote && remote.snake && remote.snake.length > 0) {
      snakeGame.globalOtherSnake = remote.snake;
      snakeGame.globalOtherScore = remote.score || 0;
      snakeGame.globalOtherDir = remote.dir || {x:1,y:0};
      document.getElementById('s2-score').textContent = remote.score || 0;
    } else {
      snakeGame.globalOtherSnake = [];
      document.getElementById('s2-score').textContent = '—';
    }
  }
  
  // ── OVERRIDE _tick: add throttled write ──
  snakeGame._originalTick = snakeGame._tick;
  snakeGame._tick = function() {
    this._originalTick.call(this);
    const now = performance.now();
    tryApplyRemoteUpdate(now);
    if (this.running && this.globalSessionRef) {
      tryWriteSnapshot(now);
    }
    if (!this.running && globalSnakeActive) {
      endGlobalSnake(null);
    }
  };
  
  // ── OVERRIDE _end: write death to Firestore, then show normal game over ──
  snakeGame._originalEnd = snakeGame._end;
  snakeGame._end = function() {
    const myKey = globalSnakePlayerId;
    // Fire-and-forget: write death to Firestore (no await needed)
    sessionRef.update({
      status: 'ended',
      endedAt: Date.now(),
      [`${myKey}.connected`]: false,
    }).catch(() => {});
    // Call global cleanup + original end overlay (shows "SIGNAL LOST" etc)
    endGlobalSnake(null);
    this._originalEnd.call(this);
  };
  
  // Override draw to show remote snake
  snakeGame._originalDraw = snakeGame._draw;
  snakeGame._draw = function() {
    this._originalDraw.call(this);
    if (this.globalOtherSnake && this.globalOtherSnake.length > 0) {
      const ctx = this.ctx;
      this.globalOtherSnake.forEach((seg, i) => {
        const t = i / this.globalOtherSnake.length;
        const cx = seg.x * SC, cy = seg.y * SC;
        ctx.globalAlpha = 1;
        ctx.fillStyle = i === 0 ? '#00ff88' : `hsl(${140 - t * 30}, 100%, ${55 - t * 20}%)`;
        if (i === 0) { ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 14; }
        ctx.fillRect(cx + 1, cy + 1, SC - 2, SC - 2);
        if (i === 0) { ctx.shadowBlur = 0;
          ctx.fillStyle = '#001a0f';
          ctx.fillRect(cx + SC * 0.27, cy + SC * 0.28, 3, 3);
          ctx.fillRect(cx + SC * 0.62, cy + SC * 0.28, 3, 3);
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      });
    }
  };
  
  // Override handleKey for global mode (only WASD)
  snakeGame._originalHandleKey = snakeGame.handleKey;
  snakeGame.handleKey = function(e) {
    if (!this.running) return;
    const p1Map = {'KeyW':{x:0,y:-1},'KeyS':{x:0,y:1},'KeyA':{x:-1,y:0},'KeyD':{x:1,y:0}};
    const d = p1Map[e.code];
    if (d && !(d.x===-this.dir.x && d.y===-this.dir.y)) { this.ndir = d; e.preventDefault(); }
  };
}

async function endGlobalSnake(reason) {
  if (!globalSnakeActive) return;
  globalSnakeActive = false;
  
  if (globalSnakeUnsub) { globalSnakeUnsub(); globalSnakeUnsub = null; }
  if (globalSnakePingTimer) { clearInterval(globalSnakePingTimer); globalSnakePingTimer = null; }
  
  // Stop the local game if it's still running
  if (snakeGame) {
    snakeGame.running = false;
    if (snakeGame.raf) {
      cancelAnimationFrame(snakeGame.raf);
      snakeGame.raf = null;
    }
  }
  
  // Clean up Firestore session
  if (globalSnakeStateRef) {
    try {
      await globalSnakeStateRef.update({
        status: 'ended',
        endedAt: Date.now(),
        [`${globalSnakePlayerId}.connected`]: false,
      }).catch(() => {});
      setTimeout(() => {
        globalSnakeStateRef.delete().catch(() => {});
        globalSnakeStateRef = null;
      }, 2000);
    } catch(e) {}
  }
  
  if (reason) {
    const ov = document.getElementById('snake-overlay');
    ov.style.display = 'flex';
    ov.innerHTML = `<h2>DISCONNECTED</h2>
      <div class="subtitle">${escHtml(reason)}</div>
      <button class="start-btn" data-act="startSnakeGlobalMultiplayer">[ PLAY AGAIN ]</button>
      <button class="start-btn" data-act="startSnake">[ SINGLE PLAYER ]</button>
      <button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
  }
  
  globalSnakePlayerId = null;
}

// ============================================================
//  STARFIGHTER
// ============================================================
class Starfighter {
  constructor() {
    this.cv = document.getElementById('sf-canvas');
    this.wrap = this.cv.parentElement;
    this.W = this.wrap.clientWidth; this.H = this.wrap.clientHeight || 560;
    this.cv.width = this.W; this.cv.height = this.H;
    this.cv.addEventListener('mousemove', e => this._onMouseMove(e));
    this.cv.addEventListener('click', () => this.fire());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000010);
    this.scene.fog = new THREE.FogExp2(0x000010, 0.008);

    this.cam = new THREE.PerspectiveCamera(70, this.W/this.H, 0.1, 500);
    
    this.rdr = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.add(new THREE.AmbientLight(0x334466, 0.6));
    const dl = new THREE.DirectionalLight(0xaaccff, 0.8);
    dl.position.set(0, 10, 5);
    this.scene.add(dl);
    this.engineLight = new THREE.PointLight(0xff6600, 2, 10);
    this.scene.add(this.engineLight);

    this._createStarfield();

    this.shipGroup = new THREE.Group();
    this._buildShip(this.shipGroup);
    this.scene.add(this.shipGroup);

    this.grpBullets = new THREE.Group(); this.scene.add(this.grpBullets);
    this.grpEnemies = new THREE.Group(); this.scene.add(this.grpEnemies);
    this.grpEnemyBullets = new THREE.Group(); this.scene.add(this.grpEnemyBullets);
    this.grpAsteroids = new THREE.Group(); this.scene.add(this.grpAsteroids);
    this.grpFX = new THREE.Group(); this.scene.add(this.grpFX);
    this.grpPowerups = new THREE.Group(); this.scene.add(this.grpPowerups);

    this.bullets = []; this.enemies = []; this.enemyBullets = [];
    this.asteroids = []; this.fx = []; this.powerups = [];

    this.running = false; this.raf = null; this.lastT = 0;
    this.score = 0; this.lives = 3; this.wave = 1; this.waveTimer = 0;
    this.shootCooldown = 0; this.powerLevel = 1; this.powerTime = 0;
    this.invincible = 0;
    this.targetX = 0; this.targetY = 0;
    this.best = parseInt(localStorage.getItem('sfBest') || '0');

    this.resize();
    this.rdr.render(this.scene, this.cam);
  }

  _createStarfield() {
    const pts = [];
    for (let i = 0; i < 1500; i++) {
      pts.push(new THREE.Vector3(
        (Math.random() - 0.5) * 300,
        (Math.random() - 0.5) * 200,
        -(Math.random() * 400 + 20)
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.PointsMaterial({
      color: 0xaaddff, size: 0.4, transparent: true, opacity: 0.8,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  _buildShip(grp) {
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.4, 2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x00ddcc, emissive: 0x004433, emissiveIntensity: 0.6,
      metalness: 0.7, roughness: 0.3,
    });
    grp.add(new THREE.Mesh(bodyGeo, bodyMat));

    const cockpitGeo = new THREE.BoxGeometry(0.4, 0.3, 0.6);
    const cockpitMat = new THREE.MeshStandardMaterial({
      color: 0xffff00, emissive: 0xffee00, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.8,
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.25, 0.3);
    grp.add(cockpit);

    const wingGeo = new THREE.BoxGeometry(2.5, 0.1, 1);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x00aacc, emissive: 0x006688, emissiveIntensity: 0.5, metalness: 0.8,
    });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.set(0, -0.1, 0.2);
    grp.add(wings);

    const tipGeo = new THREE.BoxGeometry(0.3, 0.2, 0.5);
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xff0066, emissive: 0xff0066, emissiveIntensity: 0.8,
    });
    const tipL = new THREE.Mesh(tipGeo, tipMat);
    tipL.position.set(-1.3, 0, 0.2);
    const tipR = new THREE.Mesh(tipGeo, tipMat.clone());
    tipR.position.set(1.3, 0, 0.2);
    grp.add(tipL, tipR);

    const engGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 8);
    const engMat = new THREE.MeshStandardMaterial({
      color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 1.2,
    });
    const eng1 = new THREE.Mesh(engGeo, engMat);
    eng1.rotation.x = Math.PI / 2; eng1.position.set(-0.4, 0, 1);
    const eng2 = eng1.clone(); eng2.position.set(0.4, 0, 1);
    grp.add(eng1, eng2);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo),
      new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.6 })
    );
    grp.add(edges);
  }

  _onMouseMove(e) {
    if (!this.running) return;
    const rect = this.cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    this.targetX = (x - 0.5) * 16;
    this.targetY = -(y - 0.5) * 8;
  }

  start() {
    this.score = 0; this.lives = 3; this.wave = 1; this.waveTimer = 0;
    this.powerLevel = 1; this.powerTime = 0; this.invincible = 1.5;
    clearGroup(this.grpBullets); this.bullets = [];
    clearGroup(this.grpEnemies); this.enemies = [];
    clearGroup(this.grpEnemyBullets); this.enemyBullets = [];
    clearGroup(this.grpAsteroids); this.asteroids = [];
    clearGroup(this.grpFX); this.fx = [];
    clearGroup(this.grpPowerups); this.powerups = [];
    this.shipGroup.position.set(0, 0, 0);
    this.shipGroup.rotation.set(0, 0, 0);
    this.targetX = 0; this.targetY = 0;
    this.running = true;
    this.lastT = performance.now();
    this._loop(this.lastT);
  }

  fire() {
    if (!this.running || this.shootCooldown > 0) return;
    this.shootCooldown = 0.15;
    const createBullet = (xOff) => {
      const geo = new THREE.BoxGeometry(0.1, 0.1, 1.5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
      const b = new THREE.Mesh(geo, mat);
      b.position.set(
        this.shipGroup.position.x + xOff,
        this.shipGroup.position.y,
        this.shipGroup.position.z - 2
      );
      this.grpBullets.add(b);
      this.bullets.push({ mesh: b, vz: -180 });
    };
    if (this.powerLevel >= 3) { createBullet(-0.3); createBullet(0); createBullet(0.3); }
    else if (this.powerLevel === 2) { createBullet(-0.2); createBullet(0.2); }
    else { createBullet(0); }
    beep(1200, 0.05, 'square', 0.1, 800);
  }

  _spawnEnemy(type) {
    const x = (Math.random() - 0.5) * 14;
    const y = (Math.random() - 0.5) * 8;
    const z = -100;
    let mesh, hp, vz, shootInterval;
    if (type === 'fighter') {
      const geo = new THREE.BoxGeometry(1.2, 0.5, 1.5);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff0066, emissive: 0xff0066, emissiveIntensity: 0.5, metalness: 0.7,
      });
      mesh = new THREE.Mesh(geo, mat);
      hp = 1; vz = 25 + Math.random() * 10 + this.wave * 2;
      shootInterval = Math.max(0.8, 2 - this.wave * 0.08);
    } else {
      const geo = new THREE.BoxGeometry(2, 1, 2.5);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xcc00ff, emissive: 0xcc00ff, emissiveIntensity: 0.4,
      });
      mesh = new THREE.Mesh(geo, mat);
      hp = 3; vz = 12 + this.wave;
      shootInterval = Math.max(0.6, 1.5 - this.wave * 0.05);
    }
    mesh.position.set(x, y, z);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0xff88aa })
    );
    mesh.add(edges);
    this.grpEnemies.add(mesh);
    this.enemies.push({
      mesh, hp, vz, type, shootInterval,
      shootTimer: Math.random() * shootInterval,
    });
  }

  _spawnAsteroid() {
    const x = (Math.random() - 0.5) * 16;
    const y = (Math.random() - 0.5) * 10;
    const z = -120;
    const size = 0.8 + Math.random() * 1.5;
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x886644, emissive: 0x332211, emissiveIntensity: 0.3, roughness: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xaa8866, transparent: true, opacity: 0.5 })
    );
    mesh.add(edges);
    this.grpAsteroids.add(mesh);
    this.asteroids.push({
      mesh, vz: 15 + Math.random() * 15 + this.wave * 1.5,
      rx: (Math.random() - 0.5) * 2,
      ry: (Math.random() - 0.5) * 2,
      rz: (Math.random() - 0.5) * 2,
      size, hp: Math.ceil(size / 0.8),
    });
  }

  _spawnPowerup(x, y, z) {
    if (Math.random() > 0.3) return;
    const geo = new THREE.TorusGeometry(0.5, 0.15, 8, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.grpPowerups.add(mesh);
    this.powerups.push({ mesh, vz: 10, rot: 0 });
  }

  _enemyShoot(enemy) {
    const geo = new THREE.SphereGeometry(0.2, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    const b = new THREE.Mesh(geo, mat);
    b.position.copy(enemy.mesh.position);
    b.position.z += 1;
    const dx = this.shipGroup.position.x - enemy.mesh.position.x;
    const dy = this.shipGroup.position.y - enemy.mesh.position.y;
    const dz = this.shipGroup.position.z - enemy.mesh.position.z;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    this.grpEnemyBullets.add(b);
    this.enemyBullets.push({
      mesh: b,
      vx: (dx/len) * 40, vy: (dy/len) * 40, vz: (dz/len) * 40,
    });
  }

  _explode(pos, color = 0xff6600, count = 15) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? color : 0xffaa00, transparent: true,
      });
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      this.grpFX.add(p);
      const speed = 8 + Math.random() * 10;
      const ang1 = Math.random() * Math.PI * 2;
      const ang2 = Math.random() * Math.PI * 2;
      this.fx.push({
        mesh: p,
        vx: Math.cos(ang1) * Math.cos(ang2) * speed,
        vy: Math.sin(ang2) * speed,
        vz: Math.sin(ang1) * Math.cos(ang2) * speed,
        life: 1,
      });
    }
  }

  _hitPlayer() {
    if (this.invincible > 0) return;
    this.lives--;
    this.invincible = 2;
    this._explode(this.shipGroup.position, 0x00ffcc, 20);
    beep(180, 0.4, 'sawtooth', 0.2, 60);
    if (this.lives <= 0) this._gameOver();
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;

    this.waveTimer += dt;
    const spawnRate = Math.max(0.3, 1.2 - this.wave * 0.08);
    if (Math.random() < dt / spawnRate) {
      this._spawnEnemy(Math.random() < 0.7 ? 'fighter' : 'bomber');
    }
    if (Math.random() < dt * 0.4) this._spawnAsteroid();
    if (this.score > this.wave * 1000) this.wave++;

    this.shipGroup.position.x += (this.targetX - this.shipGroup.position.x) * 6 * dt;
    this.shipGroup.position.y += (this.targetY - this.shipGroup.position.y) * 6 * dt;
    this.shipGroup.rotation.z = -(this.shipGroup.position.x - this.targetX) * 0.15;
    this.shipGroup.rotation.x = (this.shipGroup.position.y - this.targetY) * 0.15;
    this.engineLight.position.set(
      this.shipGroup.position.x, this.shipGroup.position.y, this.shipGroup.position.z + 1
    );

    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.invincible > 0) this.invincible -= dt;
    if (this.powerTime > 0) {
      this.powerTime -= dt;
      if (this.powerTime <= 0) this.powerLevel = 1;
    }

    // Bullets, enemies, etc. — same as before
    this.bullets = this.bullets.filter(b => {
      b.mesh.position.z += b.vz * dt;
      if (b.mesh.position.z < -120) {
        this.grpBullets.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.enemies = this.enemies.filter(e => {
      e.mesh.position.z += e.vz * dt;
      e.mesh.rotation.y += dt;
      e.shootTimer -= dt;
      if (e.shootTimer <= 0 && e.mesh.position.z > -80 && e.mesh.position.z < -20) {
        e.shootTimer = e.shootInterval;
        this._enemyShoot(e);
      }
      if (e.mesh.position.z > 10) {
        this.grpEnemies.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.enemyBullets = this.enemyBullets.filter(b => {
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      if (b.mesh.position.z > 10 || b.mesh.position.z < -120) {
        this.grpEnemyBullets.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.asteroids = this.asteroids.filter(a => {
      a.mesh.position.z += a.vz * dt;
      a.mesh.rotation.x += a.rx * dt;
      a.mesh.rotation.y += a.ry * dt;
      a.mesh.rotation.z += a.rz * dt;
      if (a.mesh.position.z > 10) {
        this.grpAsteroids.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.powerups = this.powerups.filter(p => {
      p.mesh.position.z += p.vz * dt;
      p.rot += dt * 2;
      p.mesh.rotation.x = p.rot; p.mesh.rotation.y = p.rot * 0.7;
      if (p.mesh.position.z > 10) {
        this.grpPowerups.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.fx = this.fx.filter(f => {
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += f.vz * dt;
      f.vy -= 10 * dt;
      f.life -= dt * 2;
      f.mesh.material.opacity = Math.max(0, f.life);
      if (f.life <= 0) {
        this.grpFX.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose();
        return false;
      }
      return true;
    });

    // Collision detection (same as original)
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (b.mesh.position.distanceTo(e.mesh.position) < 1.5) {
          e.hp--;
          this.grpBullets.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
          this.bullets.splice(i, 1);
          if (e.hp <= 0) {
            this._explode(e.mesh.position, e.type === 'bomber' ? 0xcc00ff : 0xff0066);
            this.score += e.type === 'bomber' ? 250 : 100;
            this._spawnPowerup(e.mesh.position.x, e.mesh.position.y, e.mesh.position.z);
            this.grpEnemies.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose();
            this.enemies.splice(j, 1);
            beep(400, 0.1, 'square', 0.15, 200);
          } else {
            beep(600, 0.05, 'square', 0.1);
          }
          break;
        }
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      for (let j = this.asteroids.length - 1; j >= 0; j--) {
        const a = this.asteroids[j];
        if (b.mesh.position.distanceTo(a.mesh.position) < a.size + 0.3) {
          this.grpBullets.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
          this.bullets.splice(i, 1);
          a.hp--;
          if (a.hp <= 0) {
            this._explode(a.mesh.position, 0xaa8866, 10);
            this.score += 50;
            this.grpAsteroids.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose();
            this.asteroids.splice(j, 1);
          }
          beep(300, 0.1, 'sawtooth', 0.12);
          break;
        }
      }
    }

    // Player hit detection
    if (this.invincible <= 0) {
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        if (this.shipGroup.position.distanceTo(this.enemies[j].mesh.position) < 1.8) {
          this._explode(this.enemies[j].mesh.position, 0xff0066);
          this.grpEnemies.remove(this.enemies[j].mesh);
          this.enemies[j].mesh.geometry.dispose(); this.enemies[j].mesh.material.dispose();
          this.enemies.splice(j, 1);
          this._hitPlayer(); break;
        }
      }
      for (let j = this.asteroids.length - 1; j >= 0; j--) {
        if (this.shipGroup.position.distanceTo(this.asteroids[j].mesh.position) < this.asteroids[j].size + 0.8) {
          this._explode(this.asteroids[j].mesh.position, 0xaa8866);
          this.grpAsteroids.remove(this.asteroids[j].mesh);
          this.asteroids[j].mesh.geometry.dispose(); this.asteroids[j].mesh.material.dispose();
          this.asteroids.splice(j, 1);
          this._hitPlayer(); break;
        }
      }
      for (let j = this.enemyBullets.length - 1; j >= 0; j--) {
        if (this.shipGroup.position.distanceTo(this.enemyBullets[j].mesh.position) < 1.2) {
          this.grpEnemyBullets.remove(this.enemyBullets[j].mesh);
          this.enemyBullets[j].mesh.geometry.dispose(); this.enemyBullets[j].mesh.material.dispose();
          this.enemyBullets.splice(j, 1);
          this._hitPlayer(); break;
        }
      }
    }

    // Powerup collection
    for (let j = this.powerups.length - 1; j >= 0; j--) {
      if (this.shipGroup.position.distanceTo(this.powerups[j].mesh.position) < 1.5) {
        this.powerLevel = Math.min(3, this.powerLevel + 1);
        this.powerTime = 15;
        this.grpPowerups.remove(this.powerups[j].mesh);
        this.powerups[j].mesh.geometry.dispose(); this.powerups[j].mesh.material.dispose();
        this.powerups.splice(j, 1);
        beep(800, 0.1, 'sine', 0.15);
        setTimeout(() => beep(1000, 0.1, 'sine', 0.15), 80);
        setTimeout(() => beep(1200, 0.1, 'sine', 0.15), 160);
      }
    }

    // Camera follow
    this.cam.position.x = this.shipGroup.position.x * 0.3;
    this.cam.position.y = this.shipGroup.position.y * 0.3 + 2;
    this.cam.position.z = 10;
    this.cam.lookAt(this.shipGroup.position.x * 0.5, this.shipGroup.position.y * 0.5, -10);

    this.stars.position.z += 10 * dt;
    if (this.stars.position.z > 20) this.stars.position.z -= 40;

    document.getElementById('sf-score').textContent = this.score.toLocaleString();
    document.getElementById('sf-wave').textContent = this.wave;
    document.getElementById('sf-lives').textContent = '❤'.repeat(Math.max(0, this.lives)) || '—';
    const pwEl = document.getElementById('sf-power');
    if (this.powerLevel > 1) {
      pwEl.textContent = `POWER: ${'▮'.repeat(this.powerLevel)}`;
      pwEl.style.color = 'var(--yellow)';
    } else { pwEl.textContent = ''; }

    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  _gameOver() {
    this.running = false;
    beep(200, 0.6, 'sawtooth', 0.2, 40);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('sfBest', this.best);
      syncScore('starfighter', this.score);
    }
    const isRec = this.score >= this.best && this.score > 0;
    const ov = document.getElementById('sf-overlay');
    ov.innerHTML = `<h2>MISSION FAILED</h2><div class="score-big">SCORE: ${this.score.toLocaleString()}</div><div class="subtitle">WAVE: ${this.wave}</div>${isRec?'<div class="new-rec">▓ NEW RECORD ▓</div>':`<div class="subtitle">BEST: ${this.best.toLocaleString()}</div>`}<button class="start-btn" data-act="startStarfighter">[ RETRY MISSION ]</button><button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
    ov.style.display = 'flex';
  }

  resize() {
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight || 560;
    this.cv.width = W; this.cv.height = H;
    this.cam.aspect = W / H; this.cam.updateProjectionMatrix();
    this.rdr.setSize(W, H);
  }

  handleKey(e) {
    if (!this.running) return;
    if (e.code === 'Space') { e.preventDefault(); this.fire(); }
  }
}

function startStarfighter() {
  document.getElementById('sf-overlay').style.display = 'none';
  if (!starfighterGame) starfighterGame = new Starfighter();
  starfighterGame.start();
}

// ============================================================
//  ASTEROID DEFENSE
// ============================================================
class AsteroidDefense {
  constructor() {
    this.cv = document.getElementById('ad-canvas');
    this.wrap = this.cv.parentElement;
    this.W = this.wrap.clientWidth; this.H = this.wrap.clientHeight || 560;
    this.cv.width = this.W; this.cv.height = this.H;
    this.cv.addEventListener('mousemove', e => this._onMouseMove(e));
    this.cv.addEventListener('click', () => this.fire());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000008);
    this.scene.fog = new THREE.FogExp2(0x000008, 0.012);

    this.cam = new THREE.PerspectiveCamera(60, this.W / this.H, 0.1, 200);
    this.cam.position.set(0, 35, 35);
    this.cam.lookAt(0, 0, 0);

    this.rdr = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.add(new THREE.AmbientLight(0x222244, 0.5));
    const dl = new THREE.DirectionalLight(0x88aaff, 0.6);
    dl.position.set(10, 20, 10);
    this.scene.add(dl);

    this.planetGroup = new THREE.Group();
    const planetGeo = new THREE.SphereGeometry(4, 32, 24);
    const planetMat = new THREE.MeshStandardMaterial({
      color: 0x4488ff, emissive: 0x224488, emissiveIntensity: 0.4,
      metalness: 0.3, roughness: 0.7,
    });
    this.planet = new THREE.Mesh(planetGeo, planetMat);
    this.planetGroup.add(this.planet);

    const atmGeo = new THREE.SphereGeometry(4.3, 32, 24);
    const atmMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff, transparent: true, opacity: 0.15, side: THREE.BackSide,
    });
    this.planetGroup.add(new THREE.Mesh(atmGeo, atmMat));
    this.scene.add(this.planetGroup);

    const ringGeo = new THREE.TorusGeometry(7, 0.1, 8, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffcc, transparent: true, opacity: 0.5,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.scene.add(this.ring);

    this.turretGroup = new THREE.Group();
    const turretBaseGeo = new THREE.CylinderGeometry(0.6, 0.8, 0.5, 8);
    const turretBaseMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc, metalness: 0.8,
    });
    this.turretGroup.add(new THREE.Mesh(turretBaseGeo, turretBaseMat));

    const barrelGeo = new THREE.CylinderGeometry(0.2, 0.2, 2, 8);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0xff00aa, emissive: 0xff00aa, emissiveIntensity: 0.5,
    });
    this.barrel = new THREE.Mesh(barrelGeo, barrelMat);
    this.barrel.position.set(0, 0, 1);
    this.barrel.rotation.x = Math.PI / 2;
    this.turretGroup.add(this.barrel);

    this.turretLight = new THREE.PointLight(0x00ffcc, 1, 5);
    this.turretLight.position.set(0, 0.5, 0);
    this.turretGroup.add(this.turretLight);
    this.scene.add(this.turretGroup);

    this._createStarfield();

    this.grpAsteroids = new THREE.Group(); this.scene.add(this.grpAsteroids);
    this.grpBullets = new THREE.Group(); this.scene.add(this.grpBullets);
    this.grpFX = new THREE.Group(); this.scene.add(this.grpFX);

    this.asteroids = []; this.bullets = []; this.fx = [];
    this.running = false; this.raf = null; this.lastT = 0;
    this.turretAngle = 0; this.shootCooldown = 0;
    this.score = 0; this.wave = 1; this.waveTimer = 0;
    this.planetHP = 5; this.maxPlanetHP = 5;
    this.best = parseInt(localStorage.getItem('adBest') || '0');

    this.resize();
    this.rdr.render(this.scene, this.cam);
  }

  _createStarfield() {
    const pts = [];
    for (let i = 0; i < 800; i++) {
      const r = 50 + Math.random() * 100;
      const ang = Math.random() * Math.PI * 2;
      const h = (Math.random() - 0.5) * 80;
      pts.push(new THREE.Vector3(Math.cos(ang) * r, h, Math.sin(ang) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.3, transparent: true, opacity: 0.7,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  _onMouseMove(e) {
    if (!this.running) return;
    const rect = this.cv.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    this.turretAngle = Math.atan2(y, x);
  }

  start() {
    this.score = 0; this.wave = 1; this.waveTimer = 0;
    this.planetHP = this.maxPlanetHP;
    this.turretAngle = 0; this.shootCooldown = 0;
    clearGroup(this.grpAsteroids); this.asteroids = [];
    clearGroup(this.grpBullets); this.bullets = [];
    clearGroup(this.grpFX); this.fx = [];
    this.running = true;
    this.lastT = performance.now();
    this._loop(this.lastT);
  }

  fire() {
    if (!this.running || this.shootCooldown > 0) return;
    this.shootCooldown = 0.18;
    const turretX = Math.cos(this.turretAngle) * 7;
    const turretZ = Math.sin(this.turretAngle) * 7;
    const geo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff00aa });
    const b = new THREE.Mesh(geo, mat);
    b.rotation.x = Math.PI / 2;
    b.position.set(turretX, 0.5, turretZ);
    this.grpBullets.add(b);
    this.bullets.push({
      mesh: b,
      vx: Math.cos(this.turretAngle) * 50,
      vz: Math.sin(this.turretAngle) * 50,
    });
    beep(900, 0.06, 'square', 0.12, 600);
  }

  _spawnAsteroid() {
    const ang = Math.random() * Math.PI * 2;
    const dist = 45 + Math.random() * 10;
    const size = 0.6 + Math.random() * 1.2;
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x997755, emissive: 0x332211, emissiveIntensity: 0.3, roughness: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xaa8866, transparent: true, opacity: 0.6 })
    );
    mesh.add(edges);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    mesh.position.set(x, 0, z);
    this.grpAsteroids.add(mesh);
    const speed = 4 + Math.random() * 3 + this.wave * 0.4;
    const dirAng = Math.atan2(-z, -x) + (Math.random() - 0.5) * 0.3;
    this.asteroids.push({
      mesh,
      vx: Math.cos(dirAng) * speed,
      vz: Math.sin(dirAng) * speed,
      rx: (Math.random() - 0.5) * 2,
      ry: (Math.random() - 0.5) * 2,
      size, hp: Math.ceil(size / 0.8),
    });
  }

  _explode(pos, color = 0xff6600, count = 12) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? color : 0xffaa00, transparent: true,
      });
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      this.grpFX.add(p);
      const ang = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 8;
      this.fx.push({
        mesh: p,
        vx: Math.cos(ang) * speed,
        vz: Math.sin(ang) * speed,
        vy: Math.random() * 4,
        life: 1,
      });
    }
  }

  _damagePlanet() {
    this.planetHP--;
    this._explode(new THREE.Vector3(0, 0, 0), 0x4488ff, 20);
    beep(120, 0.5, 'sawtooth', 0.25, 40);
    if (this.planetHP <= 0) this._gameOver();
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;

    this.waveTimer += dt;
    const spawnRate = Math.max(0.4, 1.2 - this.wave * 0.1);
    if (Math.random() < dt / spawnRate) this._spawnAsteroid();
    if (this.score > this.wave * 500) this.wave++;

    const turretX = Math.cos(this.turretAngle) * 7;
    const turretZ = Math.sin(this.turretAngle) * 7;
    this.turretGroup.position.set(turretX, 0, turretZ);
    this.turretGroup.rotation.y = -this.turretAngle + Math.PI / 2;

    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    this.planet.rotation.y += dt * 0.1;

    this.bullets = this.bullets.filter(b => {
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.z += b.vz * dt;
      const d = Math.sqrt(b.mesh.position.x ** 2 + b.mesh.position.z ** 2);
      if (d > 55) {
        this.grpBullets.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.asteroids = this.asteroids.filter(a => {
      a.mesh.position.x += a.vx * dt;
      a.mesh.position.z += a.vz * dt;
      a.mesh.rotation.x += a.rx * dt;
      a.mesh.rotation.y += a.ry * dt;
      const distToPlanet = Math.sqrt(a.mesh.position.x ** 2 + a.mesh.position.z ** 2);
      if (distToPlanet < 4 + a.size * 0.5) {
        this._damagePlanet();
        this._explode(a.mesh.position, 0xaa8866);
        this.grpAsteroids.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose();
        return false;
      }
      if (distToPlanet > 60) {
        this.grpAsteroids.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose();
        return false;
      }
      return true;
    });

    this.fx = this.fx.filter(f => {
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += f.vz * dt;
      f.vy -= 8 * dt;
      f.life -= dt * 2;
      f.mesh.material.opacity = Math.max(0, f.life);
      if (f.life <= 0) {
        this.grpFX.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose();
        return false;
      }
      return true;
    });

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      for (let j = this.asteroids.length - 1; j >= 0; j--) {
        const a = this.asteroids[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < a.size + 0.5) {
          a.hp--;
          this.grpBullets.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
          this.bullets.splice(i, 1);
          if (a.hp <= 0) {
            this._explode(a.mesh.position, 0xaa8866);
            this.score += Math.floor(50 * (1 + a.size));
            this.grpAsteroids.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose();
            this.asteroids.splice(j, 1);
            beep(450, 0.08, 'square', 0.14, 200);
          } else {
            beep(650, 0.04, 'square', 0.08);
          }
          break;
        }
      }
    }

    document.getElementById('ad-score').textContent = this.score.toLocaleString();
    document.getElementById('ad-wave').textContent = this.wave;
    const hpBars = '█'.repeat(this.planetHP) + '░'.repeat(this.maxPlanetHP - this.planetHP);
    document.getElementById('ad-hp').textContent = hpBars;

    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  _gameOver() {
    this.running = false;
    beep(180, 0.7, 'sawtooth', 0.22, 30);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('adBest', this.best);
      syncScore('asteroid', this.score);
    }
    const isRec = this.score >= this.best && this.score > 0;
    const ov = document.getElementById('ad-overlay');
    ov.innerHTML = `<h2>PLANET LOST</h2><div class="score-big">SCORE: ${this.score.toLocaleString()}</div><div class="subtitle">WAVE: ${this.wave}</div>${isRec?'<div class="new-rec">▓ NEW RECORD ▓</div>':`<div class="subtitle">BEST: ${this.best.toLocaleString()}</div>`}<button class="start-btn" data-act="startAsteroidDefense">[ DEFEND AGAIN ]</button><button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
    ov.style.display = 'flex';
  }

  resize() {
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight || 560;
    this.cv.width = W; this.cv.height = H;
    this.cam.aspect = W / H; this.cam.updateProjectionMatrix();
    this.rdr.setSize(W, H);
  }

  handleKey(e) {
    if (!this.running) return;
    if (e.code === 'Space') { e.preventDefault(); this.fire(); }
  }
}

function startAsteroidDefense() {
  document.getElementById('ad-overlay').style.display = 'none';
  if (!asteroidDefenseGame) asteroidDefenseGame = new AsteroidDefense();
  asteroidDefenseGame.start();
}

// ============================================================
//  VAROOM (Temple OS style pseudo-3D racer)
// ============================================================
class VaroomGame {
  constructor() {
    this.cv = document.getElementById('varoom-canvas');
    this.wrap = this.cv.parentElement;
    this.W = this.wrap.clientWidth; this.H = this.wrap.clientHeight || 560;
    this.cv.width = this.W; this.cv.height = this.H;

    this.segmentLength = 200;
    this.roadWidth = 2000;
    this.lanes = 3;
    this.drawDistance = 180;
    this.cameraHeight = 1000;
    this.cameraDepth = 1 / Math.tan((100 / 2) * Math.PI / 180);
    this.fogDensity = 5;

    this.segments = [];
    this.cars = [];
    this.trackLength = 0;

    this.position = 0;
    this.playerX = 0;
    this.speed = 0;
    this.maxSpeed = this.segmentLength * 60;
    this.accel = this.maxSpeed / 5;
    this.brake = -this.maxSpeed;
    this.decel = -this.maxSpeed / 5;
    this.offRoadDecel = -this.maxSpeed / 2;
    this.offRoadLimit = this.maxSpeed / 4;
    this.centripetal = 0.3;

    this.keys = { left: false, right: false, up: false, down: false };
    this.running = false;
    this.raf = null;
    this.lastT = 0;
    this.score = 0;
    this.distance = 0;
    this.best = parseInt(localStorage.getItem('vBest') || '0');
    document.getElementById('v-best').textContent = this.best;

    this._buildTrack();
    this.resize();
    this._render();
  }

  _buildTrack() {
    this.segments = [];
    const addSeg = (curve, y) => {
      const n = this.segments.length;
      const dark = Math.floor(n / 3) % 2 === 0;
      this.segments.push({
        index: n,
        p1: { world: { y: lastY(), z: n * this.segmentLength }, camera: {}, screen: {} },
        p2: { world: { y: y, z: (n + 1) * this.segmentLength }, camera: {}, screen: {} },
        curve: curve,
        color: dark ? {
          road: '#2a2a2a', grass: '#0a2a0a', rumble: '#aa0000', lane: '#ffffff'
        } : {
          road: '#333333', grass: '#0e350e', rumble: '#cccccc', lane: '#333333'
        },
        cars: [],
      });
    };
    const lastY = () => this.segments.length === 0 ? 0 : this.segments[this.segments.length - 1].p2.world.y;

    const addRoad = (enter, hold, leave, curve, yDelta) => {
      const startY = lastY();
      const endY = startY + yDelta * this.segmentLength;
      const total = enter + hold + leave;
      for (let n = 0; n < enter; n++) addSeg(curve * this._easeIn(0, curve, n / enter), this._easeInOut(startY, endY, n / total));
      for (let n = 0; n < hold; n++) addSeg(curve, this._easeInOut(startY, endY, (enter + n) / total));
      for (let n = 0; n < leave; n++) addSeg(curve * this._easeInOut(curve, 0, n / leave), this._easeInOut(startY, endY, (enter + hold + n) / total));
    };

    const STRAIGHT = 0, EASY = 2, MEDIUM = 4, HARD = 6;
    const addStraight = (n = 50) => addRoad(n, n, n, 0, 0);
    const addCurve = (n = 50, c = EASY, h = 0) => addRoad(n, n, n, c, h);
    const addHill = (n = 50, h = 20) => addRoad(n, n, n, 0, h);
    const addSCurves = () => {
      addRoad(25, 25, 25, -EASY, 0);
      addRoad(25, 25, 25, MEDIUM, 10);
      addRoad(25, 25, 25, EASY, -10);
      addRoad(25, 25, 25, -MEDIUM, 0);
    };

    addStraight(25);
    addHill(25, 15);
    addCurve(30, EASY, 0);
    addHill(30, -20);
    addCurve(40, -HARD, 5);
    addSCurves();
    addStraight(50);
    addCurve(40, HARD, -10);
    addHill(40, 30);
    addCurve(30, -MEDIUM, -20);
    addStraight(60);
    addCurve(50, -HARD, 15);
    addHill(30, -25);

    this.trackLength = this.segments.length * this.segmentLength;

    // Spawn AI cars
    this.cars = [];
    const totalCars = 80;
    const colors = ['#ff3366', '#ffcc00', '#00ccff', '#cc00ff', '#00ff88', '#ff8800'];
    for (let i = 0; i < totalCars; i++) {
      const segIdx = Math.floor(Math.random() * this.segments.length);
      this.cars.push({
        offset: (Math.random() * 1.6 - 0.8),
        z: segIdx * this.segmentLength + Math.random() * this.segmentLength,
        speed: this.maxSpeed / 6 + Math.random() * this.maxSpeed / 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        w: 300,
      });
    }
  }

  _easeIn(a, b, p) { return a + (b - a) * Math.pow(p, 2); }
  _easeInOut(a, b, p) { return a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5); }

  _findSegment(z) {
    return this.segments[Math.floor(z / this.segmentLength) % this.segments.length];
  }

  _project(p, cameraX, cameraY, cameraZ) {
    p.camera.x = (p.world.x || 0) - cameraX;
    p.camera.y = (p.world.y || 0) - cameraY;
    p.camera.z = (p.world.z || 0) - cameraZ;
    p.screen.scale = this.cameraDepth / p.camera.z;
    p.screen.x = Math.round(this.W / 2 + p.screen.scale * p.camera.x * this.W / 2);
    p.screen.y = Math.round(this.H / 2 - p.screen.scale * p.camera.y * this.H / 2);
    p.screen.w = Math.round(p.screen.scale * this.roadWidth * this.W / 2);
  }

  start() {
    this.position = 0;
    this.playerX = 0;
    this.speed = 0;
    this.score = 0;
    this.distance = 0;
    this.running = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.lastT = performance.now();
    this._loop(this.lastT);
    beep(220, 0.1, 'square', 0.15); setTimeout(()=>beep(440, 0.1, 'square', 0.15), 120);
    setTimeout(()=>beep(660, 0.2, 'sawtooth', 0.15), 240);
  }

  _update(dt) {
    const playerSeg = this._findSegment(this.position + this.cameraHeight);
    const speedPct = this.speed / this.maxSpeed;
    const dx = dt * 2 * speedPct;

    if (this.keys.left) this.playerX -= dx;
    if (this.keys.right) this.playerX += dx;

    // Centrifugal force from curves
    this.playerX -= dx * speedPct * playerSeg.curve * this.centripetal * 0.005;

    if (this.keys.up) this.speed += this.accel * dt;
    else if (this.keys.down) this.speed += this.brake * dt;
    else this.speed += this.decel * dt;

    // Off-road penalty
    if ((this.playerX < -1 || this.playerX > 1) && this.speed > this.offRoadLimit) {
      this.speed += this.offRoadDecel * dt;
      // Rumble sound occasionally
      if (Math.random() < 0.1) beep(80, 0.05, 'sawtooth', 0.05);
    }

    this.playerX = Math.max(-2.5, Math.min(2.5, this.playerX));
    this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed));

    this.position += this.speed * dt;
    while (this.position >= this.trackLength) this.position -= this.trackLength;
    while (this.position < 0) this.position += this.trackLength;

    this.distance += this.speed * dt;
    this.score = Math.floor(this.distance / 100);

    // AI cars
    for (const car of this.cars) {
      car.z += car.speed * dt;
      while (car.z >= this.trackLength) car.z -= this.trackLength;

      const dz = (car.z - this.position + this.trackLength) % this.trackLength;
      if (dz < 400 && dz > 0) {
        const pX = this.playerX * this.roadWidth / 2;
        const cX = car.offset * this.roadWidth / 2;
        if (Math.abs(pX - cX) < car.w * 0.6) {
          // Collision!
          this.speed = car.speed * 0.8;
          car.z = (car.z + 800) % this.trackLength;
          beep(150, 0.3, 'sawtooth', 0.25, 40);
          beep(80, 0.4, 'square', 0.15);
        }
      }
    }

    // Engine sound
    if (this.speed > 0 && Math.random() < 0.05) {
      const f = 60 + speedPct * 180;
      beep(f, 0.03, 'sawtooth', 0.02);
    }

    if (this.distance > 6000)
    {
      Achievements.unlock('varoom');
    }
  }

  _render() {
    const ctx = this.cv.getContext('2d');
    const W = this.W, H = this.H;

    // Sky gradient (Temple OS-ish dusk)
    const sky = ctx.createLinearGradient(0, 0, 0, H / 2);
    sky.addColorStop(0, '#000010');
    sky.addColorStop(0.5, '#1a0033');
    sky.addColorStop(1, '#442255');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H / 2);

    // Stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137 + Math.floor(this.position * 0.001)) % W;
      const sy = (i * 53) % (H / 2.5);
      ctx.fillRect(sx, sy, 1, 1);
    }

    // Sun/moon
    const sunX = W / 2 - (this.playerX * 30);
    ctx.fillStyle = '#ff8844';
    ctx.shadowColor = '#ff4400';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(sunX, H / 2 - 40, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ground base
    ctx.fillStyle = '#0a2a0a';
    ctx.fillRect(0, H / 2, W, H / 2);

    const baseSeg = this._findSegment(this.position);
    const basePct = (this.position % this.segmentLength) / this.segmentLength;
    const playerSeg = this._findSegment(this.position + this.cameraHeight);
    const playerPct = ((this.position + this.cameraHeight) % this.segmentLength) / this.segmentLength;
    const nextSeg = this.segments[(playerSeg.index + 1) % this.segments.length];
    const playerY = playerSeg.p1.world.y + (nextSeg.p1.world.y - playerSeg.p1.world.y) * playerPct;

    let maxY = H;
    let x = 0, dx = -(baseSeg.curve * basePct);

    // Render road strips back-to-front
    const visible = [];
    for (let n = 0; n < this.drawDistance; n++) {
      const seg = this.segments[(baseSeg.index + n) % this.segments.length];
      seg.looped = seg.index < baseSeg.index;
      seg.clip = maxY;

      this._project(seg.p1, this.playerX * this.roadWidth - x, playerY + this.cameraHeight,
        this.position - (seg.looped ? this.trackLength : 0));
      this._project(seg.p2, this.playerX * this.roadWidth - x - dx, playerY + this.cameraHeight,
        this.position - (seg.looped ? this.trackLength : 0));

      x += dx;
      dx += seg.curve;

      if (seg.p1.camera.z <= this.cameraDepth || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxY) continue;

      visible.push(seg);
      maxY = seg.p2.screen.y;
    }

    // Draw back-to-front
    for (let i = visible.length - 1; i >= 0; i--) {
      const seg = visible[i];
      const p1 = seg.p1.screen, p2 = seg.p2.screen;

      // Grass
      ctx.fillStyle = seg.color.grass;
      ctx.fillRect(0, p2.y, W, p1.y - p2.y);

      // Rumble strips
      this._poly(ctx, p1.x - p1.w * 1.2, p1.y, p1.x + p1.w * 1.2, p1.y,
        p2.x + p2.w * 1.2, p2.y, p2.x - p2.w * 1.2, p2.y, seg.color.rumble);
      // Road
      this._poly(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y,
        p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, seg.color.road);
      // Lane markers
      if (seg.color.lane === '#ffffff') {
        const lw1 = (p1.w * 2) / this.lanes * 0.05;
        const lw2 = (p2.w * 2) / this.lanes * 0.05;
        for (let lane = 1; lane < this.lanes; lane++) {
          const lx1 = p1.x - p1.w + (p1.w * 2 * lane / this.lanes);
          const lx2 = p2.x - p2.w + (p2.w * 2 * lane / this.lanes);
          this._poly(ctx, lx1 - lw1, p1.y, lx1 + lw1, p1.y,
            lx2 + lw2, p2.y, lx2 - lw2, p2.y, '#ffffff');
        }
      }

      // Fog overlay
      const fogAlpha = Math.pow(1 - (i / this.drawDistance), 2) * 0.0; // optional
      if (fogAlpha > 0.01) {
        ctx.fillStyle = `rgba(0,0,16,${1 - fogAlpha})`;
        ctx.fillRect(0, p2.y, W, p1.y - p2.y);
      }
    }

    // Draw cars (AI)
    const carsToDraw = [];
    for (const car of this.cars) {
      const relZ = (car.z - this.position + this.trackLength) % this.trackLength;
      if (relZ > this.drawDistance * this.segmentLength || relZ < 0) continue;
      const segIdx = Math.floor(car.z / this.segmentLength) % this.segments.length;
      const seg = this.segments[segIdx];
      if (!seg.p1.screen.scale) continue;
      carsToDraw.push({ car, relZ, seg });
    }
    carsToDraw.sort((a, b) => b.relZ - a.relZ);

    for (const { car, seg } of carsToDraw) {
      const scale = seg.p1.screen.scale;
      const sprW = car.w * scale * W / 2;
      const sprH = sprW * 0.6;
      const sprX = seg.p1.screen.x + (scale * car.offset * this.roadWidth * W / 2);
      const sprY = seg.p1.screen.y - sprH;
      if (sprY > H || sprY + sprH < 0) continue;

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(sprX, sprY + sprH + 2, sprW * 0.5, sprH * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.fillStyle = car.color;
      ctx.fillRect(sprX - sprW / 2, sprY, sprW, sprH);
      // Roof
      ctx.fillStyle = '#111';
      ctx.fillRect(sprX - sprW * 0.35, sprY + sprH * 0.1, sprW * 0.7, sprH * 0.35);
      // Wheels
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(sprX - sprW / 2 - 2, sprY + sprH * 0.7, sprW * 0.15, sprH * 0.3);
      ctx.fillRect(sprX + sprW / 2 - sprW * 0.15 + 2, sprY + sprH * 0.7, sprW * 0.15, sprH * 0.3);
      // Taillights
      ctx.fillStyle = '#ff2222';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 6;
      ctx.fillRect(sprX - sprW * 0.45, sprY + sprH * 0.8, sprW * 0.1, sprH * 0.12);
      ctx.fillRect(sprX + sprW * 0.35, sprY + sprH * 0.8, sprW * 0.1, sprH * 0.12);
      ctx.shadowBlur = 0;
    }

    // Player car
    this._drawPlayer(ctx, W, H);

    // Speed lines when fast
    const speedPct = this.speed / this.maxSpeed;
    if (speedPct > 0.6) {
      ctx.strokeStyle = `rgba(0,255,204,${(speedPct - 0.6) * 1.5})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const lx = (i * 127 + Math.floor(this.position * 0.1)) % W;
        const ly = H * 0.6 + (i * 47) % (H * 0.3);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx - 20, ly + 40);
        ctx.stroke();
      }
    }

    // HUD update
    const kmh = Math.round(this.speed / 50);
    document.getElementById('v-speed').textContent = kmh + ' km/h';
    document.getElementById('v-dist').textContent = Math.floor(this.distance / 100);
    document.getElementById('v-score').textContent = this.score;
  }

  _drawPlayer(ctx, W, H) {
    const carW = 170;
    const carH = 95;
    const x = W / 2;
    const y = H - 70;
    const steer = (this.keys.left ? 1 : 0) - (this.keys.right ? 1 : 0);
    const bounce = Math.sin(this.position * 0.05) * (this.speed / this.maxSpeed) * 3;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y + carH * 0.55, carW * 0.58, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x + steer * 8, y + bounce);
    ctx.rotate(steer * -0.08);

    // Body
    const bodyG = ctx.createLinearGradient(0, -carH / 2, 0, carH / 2);
    bodyG.addColorStop(0, '#00ffcc');
    bodyG.addColorStop(1, '#006655');
    ctx.fillStyle = bodyG;
    this._roundRect(ctx, -carW / 2, -carH / 2, carW, carH, 18);
    ctx.fill();

    // Hood line
    ctx.strokeStyle = '#00aa88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-carW * 0.3, -carH * 0.1);
    ctx.lineTo(carW * 0.3, -carH * 0.1);
    ctx.stroke();

    // Windshield
    ctx.fillStyle = '#001a15';
    this._roundRect(ctx, -carW * 0.35, -carH * 0.4, carW * 0.7, carH * 0.35, 8);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(-carW / 2 - 5, -carH * 0.3, 14, 28);
    ctx.fillRect(carW / 2 - 9, -carH * 0.3, 14, 28);
    ctx.fillRect(-carW / 2 - 5, carH * 0.1, 14, 28);
    ctx.fillRect(carW / 2 - 9, carH * 0.1, 14, 28);

    // Headlights
    ctx.fillStyle = '#ffffaa';
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 12;
    ctx.fillRect(-carW * 0.4, -carH / 2 - 3, 18, 8);
    ctx.fillRect(carW * 0.4 - 18, -carH / 2 - 3, 18, 8);
    ctx.shadowBlur = 0;

    // Taillights
    ctx.fillStyle = '#ff2244';
    ctx.shadowColor = '#ff0022';
    ctx.shadowBlur = 10;
    ctx.fillRect(-carW * 0.4, carH / 2 - 5, 18, 6);
    ctx.fillRect(carW * 0.4 - 18, carH / 2 - 5, 18, 6);
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  _poly(ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath(); ctx.fill();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    this._update(dt);
    this._render();
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  handleKey(e, down) {
    if (!this.running) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { this.keys.left = down; e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { this.keys.right = down; e.preventDefault(); }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { this.keys.up = down; e.preventDefault(); }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.keys.down = down; e.preventDefault(); }
  }

  resize() {
    const W = this.wrap.clientWidth;
    const H = this.wrap.clientHeight || 560;
    this.W = W; this.H = H;
    this.cv.width = W; this.cv.height = H;
  }
}

function startVaroom() {
  document.getElementById('varoom-overlay').style.display = 'none';
  if (!varoomGame) varoomGame = new VaroomGame();
  varoomGame.start();
}

// ============================================================
//  COSMIC DEFENDER (Three.js edition)
// ============================================================
class CosmicDefender {
  constructor() {
    this.cv = document.getElementById('cosmic-canvas');
    this.wrap = this.cv.parentElement;
    this.W = this.wrap.clientWidth;
    this.H = this.wrap.clientHeight || 560;
    this.cv.width = this.W;
    this.cv.height = this.H;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050f);
    this.scene.fog = new THREE.FogExp2(0x05050f, 0.012);

    this.cam = new THREE.PerspectiveCamera(60, this.W / this.H, 0.1, 250);
    this.cam.position.set(0, 22, 30);
    this.cam.lookAt(0, 0, 2);

    this.rdr = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true });
    this.rdr.setSize(this.W, this.H);
    this.rdr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Свет
    this.scene.add(new THREE.AmbientLight(0x334466, 0.65));
    const dl = new THREE.DirectionalLight(0xaaccff, 0.8);
    dl.position.set(10, 25, 15);
    this.scene.add(dl);
    const rim = new THREE.PointLight(0xff4488, 0.8, 60);
    rim.position.set(0, 10, -20);
    this.scene.add(rim);

    // Звёздное поле
    this._createStarfield();

    // Земля / платформа
    const groundGeo = new THREE.PlaneGeometry(100, 60);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a1a2a, emissive: 0x001122, emissiveIntensity: 0.3,
      metalness: 0.5, roughness: 0.8,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -2;
    this.scene.add(this.ground);

    // Сетка на земле
    const grid = new THREE.GridHelper(100, 40, 0x00ffcc, 0x003344);
    grid.position.y = -1.98;
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    this.scene.add(grid);

    // Группы объектов
    this.grpCities        = new THREE.Group();
    this.grpPlayer        = new THREE.Group();
    this.grpEnemies       = new THREE.Group();
    this.grpBullets       = new THREE.Group();
    this.grpEnemyBullets  = new THREE.Group();
    this.grpFX            = new THREE.Group();
    this.scene.add(
      this.grpCities, this.grpPlayer, this.grpEnemies,
      this.grpBullets, this.grpEnemyBullets, this.grpFX
    );

    this._buildPlayer();

    this.cities = [];
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.fx = [];
    this.wave = 1;
    this.score = 0;
    this.hits = 0;
    this.missed = 0;
    this.lives = 3;
    this.running = false;
    this.raf = null;
    this.lastT = 0;
    this.shootCooldown = 0;
    this.targetX = 0;
    this.enemyDir = 1;
    this.enemySpeedBase = 1.8;
    this.best = parseInt(localStorage.getItem('cBest') || '0');
    document.getElementById('c-best').textContent = this.best.toLocaleString();

    this.cv.addEventListener('mousemove', e => this._onMouseMove(e));
    this.cv.addEventListener('click', () => this.fire());

    this.resize();
    this.rdr.render(this.scene, this.cam);
  }

  _createStarfield() {
    const pts = [];
    for (let i = 0; i < 700; i++) {
      pts.push(new THREE.Vector3(
        (Math.random() - 0.5) * 220,
        Math.random() * 80 + 8,
        (Math.random() - 0.5) * 220 - 30
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.PointsMaterial({
      color: 0xaaddff, size: 0.35, transparent: true, opacity: 0.85,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  _buildPlayer() {
    const bodyGeo = new THREE.BoxGeometry(1.5, 0.5, 2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x00ffcc, emissive: 0x004433, emissiveIntensity: 0.6,
      metalness: 0.7, roughness: 0.3,
    });
    this.grpPlayer.add(new THREE.Mesh(bodyGeo, bodyMat));

    const cockpitGeo = new THREE.BoxGeometry(0.6, 0.4, 0.8);
    const cockpitMat = new THREE.MeshStandardMaterial({
      color: 0xffff00, emissive: 0xffee00, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.85,
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.4, -0.2);
    this.grpPlayer.add(cockpit);

    const wingGeo = new THREE.BoxGeometry(3, 0.15, 1);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x00aacc, emissive: 0x006688, emissiveIntensity: 0.5, metalness: 0.8,
    });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.set(0, -0.1, 0.3);
    this.grpPlayer.add(wings);

    const cannonGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8);
    const cannonMat = new THREE.MeshStandardMaterial({
      color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.9,
    });
    const cannon = new THREE.Mesh(cannonGeo, cannonMat);
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(0, 0.2, -1.3);
    this.grpPlayer.add(cannon);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo),
      new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.7 })
    );
    this.grpPlayer.add(edges);

    this.playerLight = new THREE.PointLight(0x00ffcc, 1.2, 8);
    this.playerLight.position.set(0, 0.5, 0);
    this.grpPlayer.add(this.playerLight);

    this.grpPlayer.position.set(0, 0, 12);
  }

  _initCities() {
    clearGroup(this.grpCities);
    this.cities = [];
    const cols = 5;
    const spacing = 8;
    const startX = -((cols - 1) * spacing) / 2;
    for (let i = 0; i < cols; i++) {
      const cityGroup = new THREE.Group();
      const x = startX + i * spacing;
      const buildings = [];
      const bCount = 3 + Math.floor(Math.random() * 2); // 3-4 здания
      for (let b = 0; b < bCount; b++) {
        const h = 1.5 + Math.random() * 2.5;
        const w = 0.8 + Math.random() * 0.6;
        const geo = new THREE.BoxGeometry(w, h, w);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x4488ff, emissive: 0x224488, emissiveIntensity: 0.55,
          metalness: 0.4, roughness: 0.5,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((b - bCount / 2) * 1.1, h / 2, 0);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.7 })
        );
        mesh.add(edges);
        cityGroup.add(mesh);
        buildings.push(mesh);
      }
      // Основание города
      const baseGeo = new THREE.BoxGeometry(5, 0.3, 3);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x224466, emissive: 0x003355, emissiveIntensity: 0.4,
      });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.set(0, -0.15, 0);
      cityGroup.add(base);

      cityGroup.position.set(x, -1.5, 10);
      this.grpCities.add(cityGroup);
      this.cities.push({
        group: cityGroup,
        buildings,
        alive: true,
        x,
      });
    }
  }

  _spawnWave() {
    const rows = Math.min(2 + Math.floor(this.wave / 2), 4);
    const cols = Math.min(5 + Math.floor(this.wave / 2), 9);
    const spacingX = 3;
    const spacingZ = 2.5;
    const startX = -((cols - 1) * spacingX) / 2;
    const startZ = -16;
    const colors = [0xff3366, 0xff8800, 0xffdd00, 0x33ff88];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = colors[r % colors.length];
        const enemyGroup = new THREE.Group();

        const bodyGeo = new THREE.BoxGeometry(1.3, 0.6, 1.3);
        const bodyMat = new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.4,
          metalness: 0.5, roughness: 0.4,
        });
        enemyGroup.add(new THREE.Mesh(bodyGeo, bodyMat));

        // "Глаза"
        const eyeGeo = new THREE.BoxGeometry(0.2, 0.2, 0.1);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(-0.3, 0, 0.7);
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(0.3, 0, 0.7);
        enemyGroup.add(eyeL, eyeR);

        // Антенны
        const antGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6);
        const antMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const ant = new THREE.Mesh(antGeo, antMat);
        ant.position.set(0, 0.55, 0);
        enemyGroup.add(ant);

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(bodyGeo),
          new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
        );
        enemyGroup.add(edges);

        const x = startX + c * spacingX;
        const z = startZ - r * spacingZ;
        enemyGroup.position.set(x, 3, z);
        this.grpEnemies.add(enemyGroup);
        this.enemies.push({
          mesh: enemyGroup,
          hp: 1 + Math.floor(this.wave / 3),
          color,
          baseX: x,
          baseZ: z,
          row: r,
          col: c,
          shootTimer: 1 + Math.random() * 4,
          type: 'invader',
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    this.enemyDir = 1;
  }

  _spawnKamikaze() {
    const x = (Math.random() - 0.5) * 32;
    const z = -22;
    const color = 0xff0066;
    const enemyGroup = new THREE.Group();
    const geo = new THREE.ConeGeometry(0.6, 1.5, 6);
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.6,
      metalness: 0.6, roughness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI;
    enemyGroup.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xff88aa })
    );
    enemyGroup.add(edges);
    enemyGroup.position.set(x, 4, z);
    this.grpEnemies.add(enemyGroup);
    this.enemies.push({
      mesh: enemyGroup,
      hp: 1,
      color,
      type: 'kamikaze',
      vz: 5 + this.wave * 0.4,
      vx: (Math.random() - 0.5) * 2,
    });
  }

  _onMouseMove(e) {
    if (!this.running) return;
    const rect = this.cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    this.targetX = (x - 0.5) * 34;
    this.targetX = Math.max(-17, Math.min(17, this.targetX));
  }

  start() {
    document.getElementById('cosmic-overlay').style.display = 'none';
    this.reset();
    this.running = true;
    this.lastT = performance.now();
    if (this.raf) cancelAnimationFrame(this.raf);
    this._loop(this.lastT);
  }

  reset() {
    this.score = 0;
    this.hits = 0;
    this.missed = 0;
    this.lives = 3;
    this.wave = 1;
    this.shootCooldown = 0;
    this.targetX = 0;
    clearGroup(this.grpEnemies);
    clearGroup(this.grpBullets);
    clearGroup(this.grpEnemyBullets);
    clearGroup(this.grpFX);
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.fx = [];
    this._initCities();
    this._spawnWave();
    this._updateHUD();
  }

  fire() {
    if (!this.running || this.shootCooldown > 0) return;
    this.shootCooldown = 0.22;
    const geo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    const b = new THREE.Mesh(geo, mat);
    b.rotation.x = Math.PI / 2;
    b.position.copy(this.grpPlayer.position);
    b.position.z -= 1.5;
    b.position.y += 0.2;
    this.grpBullets.add(b);
    this.bullets.push({ mesh: b, vz: -55 });
    beep(900, 0.05, 'square', 0.1, 1200);
  }

  _explode(pos, color = 0xff6600, count = 12) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? color : 0xffaa00, transparent: true,
      });
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      this.grpFX.add(p);
      const ang = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      this.fx.push({
        mesh: p,
        vx: Math.cos(ang) * speed,
        vy: Math.random() * 5 + 2,
        vz: Math.sin(ang) * speed,
        life: 1,
      });
    }
  }

  _damageCity(city) {
    if (!city || !city.alive) return;
    if (city.buildings.length > 0) {
      const b = city.buildings.pop();
      const worldPos = new THREE.Vector3();
      b.getWorldPosition(worldPos);
      this._explode(worldPos, 0x4488ff, 12);
      city.group.remove(b);
      b.geometry.dispose();
      b.material.dispose();
    }
    beep(150, 0.25, 'sawtooth', 0.18);
    if (city.buildings.length === 0) {
      city.alive = false;
      this.missed++;
      // Финальный взрыв города
      this._explode(city.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 0x00aaff, 25);
    }
  }

  _updateHUD() {
    document.getElementById('c-score').textContent = this.score.toLocaleString();
    document.getElementById('c-wave').textContent = this.wave;
    document.getElementById('c-hits').textContent = this.hits;
    document.getElementById('c-missed').textContent = this.missed;
    // Отображаем жизни в HUD (используем поле wave/hits — но можно добавить lives)
  }

  _enemyShoot(enemy) {
    const geo = new THREE.SphereGeometry(0.22, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    const b = new THREE.Mesh(geo, mat);
    b.position.copy(enemy.mesh.position);
    this.grpEnemyBullets.add(b);
    // Целится в игрока с небольшим разбросом
    const targetX = this.grpPlayer.position.x + (Math.random() - 0.5) * 5;
    const targetZ = this.grpPlayer.position.z;
    const dx = targetX - b.position.x;
    const dz = targetZ - b.position.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const speed = 12 + this.wave * 0.5;
    this.enemyBullets.push({
      mesh: b,
      vx: (dx / len) * speed,
      vy: -1.5,
      vz: (dz / len) * speed,
    });
    beep(300, 0.04, 'sawtooth', 0.07);
  }

  _hitPlayer() {
    this.lives--;
    this._explode(this.grpPlayer.position.clone(), 0x00ffcc, 20);
    beep(200, 0.4, 'sawtooth', 0.22, 50);
    if (this.lives <= 0) this._gameOver();
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    this._update(dt);
    this.rdr.render(this.scene, this.cam);
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  }

  _update(dt) {
    if (this.wave > 4)
    {
      Achievements.unlock('space_warrior');
    }
    // Плавное следование за мышью + лёгкий крен
    this.grpPlayer.position.x += (this.targetX - this.grpPlayer.position.x) * 8 * dt;
    this.grpPlayer.rotation.z = -(this.targetX - this.grpPlayer.position.x) * 0.08;
    if (this.shootCooldown > 0) this.shootCooldown -= dt;

    // Спавн камикадзе
    const spawnRate = Math.max(0.9, 3.5 - this.wave * 0.25);
    if (Math.random() < dt / spawnRate) this._spawnKamikaze();

    // Синхронное движение invaders (Space Invaders)
    const invaders = this.enemies.filter(e => e.type === 'invader');
    if (invaders.length > 0) {
      const speed = (this.enemySpeedBase + this.wave * 0.3) * this.enemyDir;
      let needShift = false;
      for (const e of invaders) {
        e.mesh.position.x += speed * dt;
        e.mesh.position.y = 3 + Math.sin(performance.now() * 0.003 + e.phase) * 0.15;
        e.mesh.rotation.y = Math.sin(performance.now() * 0.002 + e.phase) * 0.2;
        if (Math.abs(e.mesh.position.x) > 16) needShift = true;
      }
      if (needShift) {
        this.enemyDir *= -1;
        for (const e of invaders) e.mesh.position.z += 1.2;
      }
      // Стрельба
      for (const e of invaders) {
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = Math.max(1.5, 4 - this.wave * 0.2) + Math.random() * 2;
          if (Math.random() < 0.35) this._enemyShoot(e);
        }
      }
    }

    // Движение камикадзе
    for (const e of this.enemies) {
      if (e.type === 'kamikaze') {
        e.mesh.position.z += e.vz * dt;
        e.mesh.position.x += e.vx * dt;
        e.mesh.rotation.y += dt * 3;
      }
    }

    // Пули игрока
    this.bullets = this.bullets.filter(b => {
      b.mesh.position.z += b.vz * dt;
      if (b.mesh.position.z < -30) {
        this.grpBullets.remove(b.mesh);
        b.mesh.geometry.dispose(); b.mesh.material.dispose();
        return false;
      }
      return true;
    });

    // Пули врагов
    this.enemyBullets = this.enemyBullets.filter(b => {
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      if (b.mesh.position.z > 18 || b.mesh.position.y < -3) {
        this.grpEnemyBullets.remove(b.mesh);
        b.mesh.geometry.dispose(); b.mesh.material.dispose();
        return false;
      }
      return true;
    });

    // Удаление/обработка вышедших за границы врагов
    this.enemies = this.enemies.filter(e => {
      if (e.type === 'kamikaze' && e.mesh.position.z > 12) {
        this.grpEnemies.remove(e.mesh);
        this._explode(e.mesh.position.clone(), 0xff0066, 10);
        // Попадание по ближайшему живому городу
        let nearest = null, nd = Infinity;
        for (const city of this.cities) {
          if (!city.alive) continue;
          const d = Math.abs(e.mesh.position.x - city.x);
          if (d < 3 && d < nd) { nd = d; nearest = city; }
        }
        if (nearest) this._damageCity(nearest);
        return false;
      }
      if (e.type === 'invader' && e.mesh.position.z > 9) {
        // Invader дошёл до линии городов
        const aliveCities = this.cities.filter(c => c.alive);
        if (aliveCities.length > 0) {
          this._damageCity(aliveCities[Math.floor(Math.random() * aliveCities.length)]);
        }
        this.grpEnemies.remove(e.mesh);
        return false;
      }
      return true;
    });

    // Коллизии: пули игрока vs враги (XZ-плоскость)
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let hit = false;
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        const dx = b.mesh.position.x - e.mesh.position.x;
        const dz = b.mesh.position.z - e.mesh.position.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        if (distXZ < 1.3) {
          e.hp--;
          this.grpBullets.remove(b.mesh);
          b.mesh.geometry.dispose(); b.mesh.material.dispose();
          this.bullets.splice(i, 1);
          if (e.hp <= 0) {
            this._explode(e.mesh.position.clone(), e.color, 15);
            this.score += e.type === 'kamikaze' ? 50 : 100;
            this.hits++;
            this.grpEnemies.remove(e.mesh);
            this.enemies.splice(j, 1);
            beep(400, 0.1, 'square', 0.14, 200);
          } else {
            beep(600, 0.05, 'square', 0.1);
          }
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }

    // Коллизии: пули врагов vs игрок (XZ-плоскость)
    if (this.lives > 0) {
      for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
        const b = this.enemyBullets[i];
        const dx = b.mesh.position.x - this.grpPlayer.position.x;
        const dz = b.mesh.position.z - this.grpPlayer.position.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        if (distXZ < 1.5) {
          this.grpEnemyBullets.remove(b.mesh);
          b.mesh.geometry.dispose(); b.mesh.material.dispose();
          this.enemyBullets.splice(i, 1);
          this._hitPlayer();
          break;
        }
      }
      // Коллизии: камикадзе vs игрок (XZ-плоскость)
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (e.type === 'kamikaze') {
          const dx = e.mesh.position.x - this.grpPlayer.position.x;
          const dz = e.mesh.position.z - this.grpPlayer.position.z;
          const distXZ = Math.sqrt(dx * dx + dz * dz);
          if (distXZ < 1.8) {
            this._explode(e.mesh.position.clone(), 0xff0066, 15);
            this.grpEnemies.remove(e.mesh);
            this.enemies.splice(j, 1);
            this._hitPlayer();
            break;
          }
        }
      }
    }

    // Частицы
    this.fx = this.fx.filter(f => {
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += f.vz * dt;
      f.vy -= 12 * dt;
      f.life -= dt * 1.8;
      f.mesh.material.opacity = Math.max(0, f.life);
      if (f.life <= 0) {
        this.grpFX.remove(f.mesh);
        f.mesh.geometry.dispose(); f.mesh.material.dispose();
        return false;
      }
      return true;
    });

    // Конец волны
    const aliveInvaders = this.enemies.filter(e => e.type === 'invader').length;
    if (aliveInvaders === 0 && this.running) {
      this.wave++;
      this._spawnWave();
    }

    // Условие поражения: все города уничтожены ИЛИ 0 жизней
    const aliveCities = this.cities.filter(c => c.alive).length;
    if ((aliveCities === 0 || this.lives <= 0) && this.running) {
      this._gameOver();
      return;
    }

    this._updateHUD();
    this.stars.rotation.y += dt * 0.008;
  }

  _gameOver() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    beep(180, 0.7, 'sawtooth', 0.22, 30);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('cBest', this.best);
      syncScore('cosmic', this.score);
    }
    const isRec = this.score >= this.best && this.score > 0;
    const ov = document.getElementById('cosmic-overlay');
    ov.innerHTML = `<h2>GAME OVER</h2>
      <div class="score-big">${this.score.toLocaleString()}</div>
      <div class="subtitle">WAVE: ${this.wave} | HIT: ${this.hits} | MISSED: ${this.missed}</div>
      ${isRec ? '<div class="new-rec">▓ NEW RECORD ▓</div>' : `<div class="subtitle">BEST: ${this.best.toLocaleString()}</div>`}
      <button class="start-btn" data-act="startCosmic">[ LAUNCH AGAIN ]</button>
      <button class="start-btn" data-act="backToCatalog" style="margin-top:6px;border-color:var(--pink);color:var(--pink);box-shadow:var(--gpink);">[ BACK TO GAMES ]</button>`;
    ov.style.display = 'flex';
  }

  resize() {
    const W = this.wrap.clientWidth;
    const H = this.wrap.clientHeight || 560;
    this.W = W; this.H = H;
    this.cv.width = W; this.cv.height = H;
    this.cam.aspect = W / H;
    this.cam.updateProjectionMatrix();
    this.rdr.setSize(W, H);
  }

  handleKey(e) {
    if (!this.running) return;
    if (e.code === 'Space') { this.fire(); e.preventDefault(); }
  }
}

function startCosmic() {
  document.getElementById('cosmic-overlay').style.display = 'none';
  if (!cosmicGame) cosmicGame = new CosmicDefender();
  cosmicGame.running = true;
  cosmicGame.start();
}

// ============================================================
//  INPUT ROUTER
// ============================================================
window.addEventListener('keydown', e=>{
  if (e.code === 'Escape' && currentTab !== null) {
    e.preventDefault();
    backToCatalog();
    return;
  }

  // Navigation on cartridge menu
  if (currentTab === null && cartridgeMenu) {
    const count = cartridgeMenu.configs.length;
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
      e.preventDefault();
      cartridgeMenu.selectedIndex = (cartridgeMenu.selectedIndex + 1) % count;
      cartridgeMenu.selectByKeyboard(cartridgeMenu.selectedIndex);
      sndSelect();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
      e.preventDefault();
      cartridgeMenu.selectedIndex = (cartridgeMenu.selectedIndex - 1 + count) % count;
      cartridgeMenu.selectByKeyboard(cartridgeMenu.selectedIndex);
      sndSelect();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      if (cartridgeMenu.selectedIndex >= 0 && !cartridgeMenu.isAnimating) {
        const idx = cartridgeMenu.selectedIndex;
        const cfg = cartridgeMenu.configs[idx];
        cartridgeMenu._ejectAnimation(idx, cfg.game);
      }
    }
    return;
  }

  // Tetris duel mode has its own input routing
  if (currentTab==='tetris' && tetrisDuelActive) {
    handleDuelKey(e);
    if (['KeyA','KeyD','KeyW','KeyS','Space','KeyC','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Numpad0','Numpad1','Numpad4'].includes(e.code)) e.preventDefault();
    return;
  }
  
  // Game-specific controls
  if (currentTab==='tetris' && tetrisGame) tetrisGame.handleKey(e);
  if (currentTab==='runner' && runnerGame && (e.code==='Space'||e.code==='ArrowUp')) { e.preventDefault(); runnerGame.jump(); }
  if (currentTab==='snake'  && snakeGame)  snakeGame.handleKey(e);
  if (currentTab==='starfighter' && starfighterGame) starfighterGame.handleKey(e);
  if (currentTab==='asteroid' && asteroidDefenseGame) asteroidDefenseGame.handleKey(e);
  if (currentTab==='varoom' && varoomGame) varoomGame.handleKey(e, true);
  
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
    if (['tetris','runner','snake','starfighter','asteroid'].includes(currentTab)) e.preventDefault();
  }
});

document.getElementById('runner-canvas').addEventListener('click', ()=>{ if(runnerGame) runnerGame.jump(); });
document.getElementById('runner-canvas').addEventListener('touchstart', e=>{ e.preventDefault(); if(runnerGame) runnerGame.jump(); },{passive:false});

window.addEventListener('resize', ()=>{
  if(tetrisGame) tetrisGame.resize();
  if(runnerGame) runnerGame.resize();
  if(starfighterGame) starfighterGame.resize();
  if(asteroidDefenseGame) asteroidDefenseGame.resize();
  if(tetrisDuelP1) tetrisDuelP1.resize();
  if(tetrisDuelP2) tetrisDuelP2.resize();
  if(varoomGame) varoomGame.resize();
});

window.addEventListener('keyup', e => {
  if (currentTab==='varoom' && varoomGame) varoomGame.handleKey(e, false);
});


// ============================================================
//  🚀 INIT
// ============================================================
function initMinis() {
  if (!menuScene) menuScene = new MenuScene();
  if (!cartridgeMenu) cartridgeMenu = new CartridgeMenu();
  loadAllLeaderboards();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMinis);
else initMinis();
