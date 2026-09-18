/* EgorNetwork — главная: заголовок, счётчик сезона, терминал. */
(function () {
  'use strict';
  var el = window.EN.el;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Побуквенная анимация заголовка ─────────────────────────────────── */
  var i = 0;
  document.querySelectorAll('[data-split]').forEach(function (line) {
    var text = line.textContent;
    line.textContent = '';
    line.setAttribute('aria-hidden', 'true');
    Array.prototype.forEach.call(text, function (ch) {
      var s = el('span', { class: 'ch', text: ch });
      s.style.setProperty('--i', i++);
      line.appendChild(s);
    });
  });

  /* ── Счётчик до лета / зимы ─────────────────────────────────────────── */
  var counter = document.getElementById('counter');
  var wheels = {};

  function buildCounter() {
    [['d', 3, 'дней'], ['h', 2, 'часов'], ['m', 2, 'минут'], ['s', 2, 'секунд']].forEach(function (cfg) {
      var num = el('div', { class: 'counter__num' });
      wheels[cfg[0]] = [];
      for (var n = 0; n < cfg[1]; n++) {
        var strip = el('div', { class: 'wheel__strip' });
        for (var dgt = 0; dgt < 10; dgt++) strip.appendChild(el('span', { text: String(dgt) }));
        num.appendChild(el('div', { class: 'wheel' }, strip));
        wheels[cfg[0]].push(strip);
      }
      counter.appendChild(el('div', { class: 'counter__cell' }, [num, el('span', { class: 'counter__lbl', text: cfg[2] })]));
    });
  }

  function setWheels(key, value) {
    var strips = wheels[key];
    var str = String(Math.max(0, value)).padStart(strips.length, '0').slice(-strips.length);
    strips.forEach(function (strip, idx) {
      strip.style.transform = 'translateY(' + (-Number(str[idx]) * 10) + '%)';
    });
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m100 >= 11 && m100 <= 14) return many;
    if (m10 === 1) return one;
    if (m10 >= 2 && m10 <= 4) return few;
    return many;
  }

  function seasonState(now) {
    var y = now.getFullYear();
    var summerStart = new Date(y, 5, 1), summerEnd = new Date(y, 8, 1);
    var winterStart = now < new Date(y, 2, 1) ? new Date(y - 1, 11, 1) : new Date(y, 11, 1);
    var winterEnd = new Date(winterStart.getFullYear() + 1, 2, 1);
    if (now >= summerStart && now < summerEnd) return { now: 'summer' };
    if (now >= winterStart && now < winterEnd) return { now: 'winter' };
    var nextSummer = now >= summerEnd ? new Date(y + 1, 5, 1) : summerStart;
    var winterNext = winterStart < nextSummer;
    var target = winterNext ? winterStart : nextSummer;
    var from = winterNext ? new Date(y, 8, 1) : new Date(target.getFullYear(), 2, 1);
    return { season: winterNext ? 'winter' : 'summer', target: target, from: from };
  }

  var q = document.getElementById('season-q');
  var a = document.getElementById('season-a');
  var chip = document.getElementById('season-chip');
  var bar = document.getElementById('season-bar');
  var meta = document.getElementById('season-meta');
  var lastSeason = null;

  function tick() {
    var now = new Date();
    var st = seasonState(now);
    if (st.now) {
      if (lastSeason !== st.now) {
        lastSeason = st.now;
        counter.classList.add('hidden');
        bar.parentNode.classList.add('hidden');
        q.textContent = st.now === 'summer' ? 'Эй, когда уже лето?' : 'Эй, когда уже зима?';
        a.textContent = st.now === 'summer' ? 'Оно уже здесь ☀ Иди погуляй. Или поиграй.' : 'Она уже здесь ❄ Самое время для игр под пледом.';
        chip.textContent = 'season: ' + st.now;
        meta.textContent = '';
      }
      return;
    }
    var diff = st.target - now;
    var d = Math.floor(diff / 864e5), h = Math.floor(diff % 864e5 / 36e5);
    var m = Math.floor(diff % 36e5 / 6e4), s = Math.floor(diff % 6e4 / 1e3);
    if (lastSeason !== st.season) {
      lastSeason = st.season;
      var w = st.season === 'winter';
      q.textContent = w ? 'Эй, когда уже зима?' : 'Эй, когда уже лето?';
      chip.textContent = w ? 'countdown_to_winter()' : 'countdown_to_summer()';
    }
    a.textContent = 'Осталось ' + d + ' ' + plural(d, 'день', 'дня', 'дней') + '. ' +
      (d < 30 ? 'Уже совсем скоро!' : d < 90 ? 'Потерпи, это недолго.' : 'Можно успеть выпустить игру.');
    setWheels('d', d); setWheels('h', h); setWheels('m', m); setWheels('s', s);
    var pct = Math.min(100, Math.max(0, (now - st.from) / (st.target - st.from) * 100));
    bar.style.width = pct.toFixed(1) + '%';
    meta.textContent = (st.season === 'winter' ? 'осень' : 'весна') + ' пройдена на ' + Math.round(pct) + '%';
  }

  if (counter) {
    buildCounter();
    tick();
    setInterval(tick, 1000);
  }

  /* ── Терминал ───────────────────────────────────────────────────────── */
  var out = document.getElementById('term-out');
  var form = document.getElementById('term-form');
  var input = document.getElementById('term-in');
  if (!out || !form) return;

  var history = [], hIdx = 0;

  function print(text, cls) {
    out.appendChild(el('div', { class: cls || '', text: text }));
    while (out.childNodes.length > 200) out.removeChild(out.firstChild);
    out.scrollTop = out.scrollHeight;
  }

  // Безопасный калькулятор: токенизатор + рекурсивный спуск, без eval/Function.
  function calc(src) {
    var tokens = src.match(/\d+(?:[.,]\d+)?|[()+\-*/%^]/g);
    if (!tokens || tokens.join('').length !== src.replace(/\s+/g, '').length) throw new Error('bad');
    var pos = 0;
    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }
    function primary() {
      var t = next();
      if (t === '(') { var v = expr(); if (next() !== ')') throw new Error('bad'); return v; }
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (t !== undefined && /^\d/.test(t)) return parseFloat(t.replace(',', '.'));
      throw new Error('bad');
    }
    function power() { var b = primary(); if (peek() === '^') { next(); return Math.pow(b, power()); } return b; }
    function term() {
      var v = power();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        var op = next(), r = power();
        v = op === '*' ? v * r : op === '/' ? v / r : v % r;
      }
      return v;
    }
    function expr() {
      var v = term();
      while (peek() === '+' || peek() === '-') { var op = next(); v = op === '+' ? v + term() : v - term(); }
      return v;
    }
    var res = expr();
    if (pos !== tokens.length || !isFinite(res)) throw new Error('bad');
    return Math.round(res * 1e10) / 1e10;
  }

  var QUOTES = [
    ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
    ['Make it work, make it right, make it fast.', 'Kent Beck'],
    ['First, solve the problem. Then, write the code.', 'John Johnson'],
    ['Simplicity is the soul of efficiency.', 'Austin Freeman'],
    ['Programs must be written for people to read.', 'Harold Abelson'],
    ['Truth can only be found in one place: the code.', 'Robert C. Martin']
  ];

  var go = function (href) { return function () { print('→ открываю ' + href, 't-ok'); setTimeout(function () { location.href = href; }, 350); }; };

  var COMMANDS = {
    help: function () {
      print('Команды:', 't-acc');
      [
        'games      — наши игры',
        'minis      — мини-игры в браузере',
        'blog       — блог студии',
        'photos     — фотогалерея',
        'donate     — поддержать',
        'season     — сколько до лета/зимы',
        'calc 2+2*2 — калькулятор',
        'quote      — случайная цитата',
        'coin       — подбросить монетку',
        'date       — текущая дата',
        'whoami     — кто ты',
        'clear      — очистить экран'
      ].forEach(function (l) { print(l, 't-dim'); });
    },
    games: go('games.html'),
    minis: go('minis.html'),
    blog: go('blog.html'),
    photos: go('photos.html'),
    donate: go('donations.html'),
    season: function () { print(a.textContent || '…', 't-ok'); },
    'лето': function () { COMMANDS.season(); },
    'зима': function () { COMMANDS.season(); },
    calc: function (args) {
      if (!args) { print('использование: calc 2+2*2', 't-dim'); return; }
      try { print('= ' + calc(args), 't-ok'); } catch (e) { print('ошибка: не могу посчитать «' + args + '»', 't-err'); }
    },
    quote: function () {
      var qt = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      print('«' + qt[0] + '»', 't-acc'); print('  — ' + qt[1], 't-dim');
    },
    coin: function () { print(Math.random() < 0.5 ? 'Орёл 🦅' : 'Решка 🪙', 't-ok'); },
    date: function () { print(new Date().toLocaleString('ru-RU'), 't-ok'); },
    whoami: function () { print('guest. А кто сидит по ту сторону — не скажем. OPSEC 😎', 't-ok'); },
    sudo: function () { print('guest не входит в sudoers. Инцидент будет записан.', 't-err'); },
    rm: function () { print('Хорошая попытка.', 't-err'); },
    exit: function () { print('Отсюда не выходят. Только в игры.', 't-dim'); },
    hello: function () { print('Привет! Попробуй help.', 't-ok'); },
    'привет': function () { COMMANDS.hello(); },
    archive: function (args) {
      if (args === '014') { go('coridore.html')(); return; }
      print('архив пуст. или нет?', 't-dim');
    },
    clear: function () { out.textContent = ''; }
  };

  function run(line) {
    var raw = line.trim();
    if (!raw) return;
    print(raw, 't-in');
    var sp = raw.indexOf(' ');
    var cmd = (sp === -1 ? raw : raw.slice(0, sp)).toLowerCase();
    var args = sp === -1 ? '' : raw.slice(sp + 1).trim();
    if (Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) { COMMANDS[cmd](args); return; }
    if (/^[\d\s()+\-*/%^.,]+$/.test(raw)) { COMMANDS.calc(raw); return; }
    print('команда не найдена: ' + cmd + ' (введи help)', 't-err');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value;
    if (v.trim()) { history.push(v); hIdx = history.length; }
    input.value = '';
    run(v);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp' && hIdx > 0) { hIdx--; input.value = history[hIdx]; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { hIdx = Math.min(history.length, hIdx + 1); input.value = history[hIdx] || ''; e.preventDefault(); }
  });

  // Приветствие с эффектом печати
  var greet = ['EgorNetwork shell v2.0', 'Введи help, чтобы увидеть команды.'];
  if (reduced) { greet.forEach(function (l, k) { print(l, k ? 't-dim' : 't-acc'); }); return; }
  var line = 0;
  (function typeLine() {
    if (line >= greet.length) return;
    var node = el('div', { class: line ? 't-dim' : 't-acc' });
    out.appendChild(node);
    var txt = greet[line], k = 0;
    (function typeChar() {
      node.textContent = txt.slice(0, ++k);
      if (k < txt.length) setTimeout(typeChar, 22);
      else { line++; setTimeout(typeLine, 180); }
    })();
  })();
})();
