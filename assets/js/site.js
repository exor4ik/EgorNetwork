/* ==========================================================================
   EgorNetwork — site.js
   Общие шапка/подвал, навигация, анимации. Подключается в <head> БЕЗ defer:
   сразу ставит класс .js (чтобы не было мигания reveal-блоков), остальное
   делает на DOMContentLoaded.

   Правило безопасности: никакого innerHTML/insertAdjacentHTML. Весь DOM
   собирается через el()/icon(), текст — только через textContent. На
   статических страницах это дополнительно enforced через Trusted Types в CSP.
   ========================================================================== */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var LINKS = {
    telegram: 'https://t.me/egornetwork_official',
    discord: 'https://discord.gg/4e3wN9t79R',
    boosty: 'https://boosty.to/egornetwork'
  };

  var NAV = [
    { href: 'index.html', label: 'Главная' },
    { href: 'games.html', label: 'Игры' },
    { href: 'minis.html', label: 'Мини-игры' },
    { href: 'anthill.html', label: 'Муравейник' },
    { href: 'blog.html', label: 'Блог' },
    { href: 'useful.html', label: 'Полезное' }
  ];
  var MORE = [
    { href: 'photos.html', label: 'Фотогалерея' },
    { href: 'linux.html', label: 'Игры на Linux' },
    { href: 'blocks.html', label: 'Обход блокировок' },
    { href: 'video-compressor.html', label: 'Компрессор видео' },
    { href: 'audio-compressor.html', label: 'Компрессор аудио' },
    { href: 'donations.html', label: 'Поддержать' },
    { href: 'license.html', label: 'Лицензия' }
  ];

  /* ── DOM helpers ─────────────────────────────────────────────────────── */
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined) return node;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // Иконки: набор path-данных (stroke 2, viewBox 24).
  var ICONS = {
    arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
    'arrow-up-right': ['M7 17L17 7', 'M8 7h9v9'],
    chevron: ['M6 9l6 6 6-6'],
    close: ['M18 6L6 18', 'M6 6l12 12'],
    left: ['M15 18l-6-6 6-6'],
    right: ['M9 18l6-6-6-6'],
    download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
    gamepad: ['M6 11h4', 'M8 9v4', 'M15 12h.01', 'M18 10h.01', 'M17.32 5H6.68a4 4 0 0 0-3.98 3.59L2 15a3 3 0 0 0 5.2 2.05L9 15h6l1.8 2.05A3 3 0 0 0 22 15l-.7-6.41A4 4 0 0 0 17.32 5z'],
    terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
    image: ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M15.5 8.5h.01'],
    film: ['M3 4h18v16H3z', 'M7 4v16', 'M17 4v16', 'M3 9h4', 'M3 15h4', 'M17 9h4', 'M17 15h4'],
    music: ['M9 18V5l12-2v13', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
    penguin: ['M12 2a5 5 0 0 0-5 5v3c-2 2-3 5-3 7 0 3 3 5 8 5s8-2 8-5c0-2-1-5-3-7V7a5 5 0 0 0-5-5z', 'M10 8h.01', 'M14 8h.01', 'M10.5 11h3'],
    heart: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z'],
    file: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 13h8', 'M8 17h5'],
    upload: ['M12 21V9', 'M7 14l5-5 5 5', 'M5 3h14'],
    send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z'],
    copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    plus: ['M12 5v14', 'M5 12h14'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
    trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    clip: ['M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
    ant: ['M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M12 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M10 5L8 2', 'M14 5l2-3', 'M9.5 11.5L5 10', 'M14.5 11.5L19 10', 'M9.5 17L5 19', 'M14.5 17l4.5 2']
  };

  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  // Внешняя ссылка: всегда noopener + noreferrer.
  function extLink(href, children, cls) {
    return el('a', { href: href, class: cls, target: '_blank', rel: 'noopener noreferrer' }, children);
  }

  function currentPage() {
    var last = location.pathname.split('/').pop();
    return last && last.indexOf('.') !== -1 ? last : 'index.html';
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  function buildHeader(host) {
    var page = currentPage();
    var cur = function (href) { return href === page ? 'page' : null; };

    var nav = el('nav', { class: 'nav', 'aria-label': 'Основная навигация' });
    var pill = el('span', { class: 'nav__pill', 'aria-hidden': 'true' });
    nav.appendChild(pill);
    NAV.forEach(function (item) {
      nav.appendChild(el('a', { href: item.href, 'aria-current': cur(item.href), text: item.label }));
    });

    var moreActive = MORE.some(function (i) { return i.href === page; });
    var menuId = 'nav-more-menu';
    var moreBtn = el('button', {
      class: 'nav__more', type: 'button', 'aria-expanded': 'false', 'aria-controls': menuId
    }, ['Ещё', icon('chevron')]);
    if (moreActive) moreBtn.style.color = 'var(--text)';
    var menu = el('div', { class: 'nav__menu', id: menuId });
    MORE.forEach(function (item) {
      menu.appendChild(el('a', { href: item.href, 'aria-current': cur(item.href), text: item.label }));
    });
    var drop = el('div', { class: 'nav__drop' }, [moreBtn, menu]);
    nav.appendChild(drop);

    var burger = el('button', {
      class: 'burger', type: 'button', 'aria-label': 'Меню', 'aria-expanded': 'false', 'aria-controls': 'mobile-nav'
    }, [el('span'), el('span'), el('span')]);

    var brand = el('a', { class: 'brand', href: 'index.html', 'aria-label': 'EgorNetwork — на главную' }, [
      el('img', { src: 'assets/img/icon-192.png', alt: '', width: 30, height: 30 }),
      el('span', null, ['Egor', el('b', { text: 'Network' })])
    ]);

    append(host, el('div', { class: 'wrap site-header__inner' }, [brand, nav, burger]));

    var mobile = el('nav', { class: 'mobile-nav', id: 'mobile-nav', 'aria-label': 'Мобильная навигация' });
    NAV.concat(MORE).forEach(function (item, i) {
      var a = el('a', { href: item.href, 'aria-current': cur(item.href), text: item.label });
      a.style.setProperty('--i', i);
      mobile.appendChild(a);
    });
    host.after(mobile);

    // Выпадающее «Ещё»
    function setDrop(open) {
      drop.classList.toggle('is-open', open);
      moreBtn.setAttribute('aria-expanded', String(open));
    }
    moreBtn.addEventListener('click', function (e) { e.stopPropagation(); setDrop(!drop.classList.contains('is-open')); });
    document.addEventListener('click', function (e) { if (!drop.contains(e.target)) setDrop(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (drop.classList.contains('is-open')) { setDrop(false); moreBtn.focus(); }
      if (mobile.classList.contains('is-open')) { setMobile(false); burger.focus(); }
    });

    // Мобильное меню
    function setMobile(open) {
      mobile.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('nav-open', open);
    }
    burger.addEventListener('click', function () { setMobile(!mobile.classList.contains('is-open')); });
    window.addEventListener('resize', function () { if (window.innerWidth > 880) setMobile(false); });

    // «Пилюля», скользящая за курсором по пунктам меню
    nav.addEventListener('pointerover', function (e) {
      var t = e.target.closest('.nav > a, .nav__more');
      if (!t) return;
      pill.style.width = t.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + t.offsetLeft + 'px)';
      pill.style.opacity = '1';
    });
    nav.addEventListener('pointerleave', function () { pill.style.opacity = '0'; });

    // Фон шапки после прокрутки
    var onScroll = function () { host.classList.toggle('is-scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── Footer ──────────────────────────────────────────────────────────── */
  function buildFooter(host) {
    var col = function (title, items) {
      return el('div', null, [
        el('p', { class: 'footer__title', text: title }),
        el('ul', { class: 'footer__links' }, items.map(function (i) { return el('li', null, i); }))
      ]);
    };
    var year = new Date().getFullYear();

    append(host, el('div', { class: 'wrap' }, [
      el('div', { class: 'footer__grid' }, [
        el('div', { class: 'stack' }, [
          el('a', { class: 'brand', href: 'index.html' }, [
            el('img', { src: 'assets/img/icon-192.png', alt: '', width: 30, height: 30 }),
            el('span', null, ['Egor', el('b', { text: 'Network' })])
          ]),
          el('p', { class: 'footer__legal' }, [
            '© 2024–' + year + ' EgorNetwork. Использование игр, ассетов и материалов — только по ',
            el('a', { href: 'license.html', text: 'лицензии A.I.O.T.' }),
            ' Запрос прав — через тикет в нашем Discord.'
          ])
        ]),
        col('Сообщество', [
          extLink(LINKS.telegram, 'Telegram'),
          extLink(LINKS.discord, 'Discord'),
          extLink(LINKS.boosty, 'Boosty')
        ]),
        col('Сайт', [
          el('a', { href: 'games.html', text: 'Игры' }),
          el('a', { href: 'photos.html', text: 'Фотогалерея' }),
          el('a', { href: 'donations.html', text: 'Поддержать' }),
          el('a', { href: 'license.html', text: 'Лицензия' })
        ])
      ]),
      el('div', { class: 'footer__word', 'aria-hidden': 'true', text: 'EgorNetwork' })
    ]));
  }

  /* ── Ambient background + progress bar ───────────────────────────────── */
  function buildAmbient() {
    document.body.prepend(
      el('div', { class: 'ambient', 'aria-hidden': 'true' }, [
        el('div', { class: 'blob blob--a' }), el('div', { class: 'blob blob--b' }), el('div', { class: 'blob blob--c' })
      ]),
      el('div', { class: 'progress', 'aria-hidden': 'true' }),
      el('a', { class: 'skip-link', href: '#main', text: 'К содержимому' })
    );
  }

  /* ── Reveal on scroll ────────────────────────────────────────────────── */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    document.querySelectorAll('[data-stagger]').forEach(function (group) {
      Array.prototype.forEach.call(group.children, function (child, i) {
        child.classList.add('reveal');
        child.style.setProperty('--d', i);
      });
    });
    items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (n) { io.observe(n); });
  }

  /* ── Pointer spotlight на карточках и кнопках ────────────────────────── */
  function initSpotlight() {
    if (!window.matchMedia('(hover: hover)').matches) return;
    var pending = null;
    var scheduled = false;
    document.addEventListener('pointermove', function (e) {
      pending = e;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        var ev = pending; pending = null; scheduled = false;
        if (!ev) return;
        var t = ev.target.closest && ev.target.closest('.card, .btn');
        if (!t) return;
        var r = t.getBoundingClientRect();
        t.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
        t.style.setProperty('--my', (ev.clientY - r.top) + 'px');
      });
    }, { passive: true });
  }

  /* ── Копирование в буфер ─────────────────────────────────────────────── */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = el('textarea', { readonly: true, 'aria-hidden': 'true' });
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
      catch (e) { reject(e); }
      ta.remove();
    });
  }

  function initCopy() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy], [data-copy-from]');
      if (!btn) return;
      var text = btn.getAttribute('data-copy');
      if (text === null) {
        var src = document.getElementById(btn.getAttribute('data-copy-from'));
        text = src ? src.textContent.trim() : '';
      }
      var label = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', label);
      copyText(text).then(function () {
        btn.textContent = 'Скопировано ✓';
        btn.classList.add('is-done');
      }, function () {
        btn.textContent = 'Не вышло';
      }).then(function () {
        setTimeout(function () { btn.textContent = label; btn.classList.remove('is-done'); }, 2000);
      });
    });
  }

  /* ── Страховка: любые target=_blank ссылки получают noopener ──────────── */
  function hardenLinks() {
    document.querySelectorAll('a[target="_blank"]').forEach(function (a) {
      var rel = (a.getAttribute('rel') || '').split(/\s+/);
      ['noopener', 'noreferrer'].forEach(function (r) { if (rel.indexOf(r) === -1) rel.push(r); });
      a.setAttribute('rel', rel.join(' ').trim());
    });
  }

  // Публичный мини-API для страничных скриптов.
  window.EN = { el: el, icon: icon, append: append, extLink: extLink, copyText: copyText, LINKS: LINKS };

  document.addEventListener('DOMContentLoaded', function () {
    var header = document.getElementById('site-header');
    var footer = document.getElementById('site-footer');
    if (header) buildHeader(header);
    if (footer) buildFooter(footer);
    if (!document.body.hasAttribute('data-no-ambient')) buildAmbient();
    document.querySelectorAll('[data-icon]').forEach(function (n) {
      n.appendChild(icon(n.getAttribute('data-icon'), n.getAttribute('data-icon-class')));
    });
    hardenLinks();
    initReveal();
    initSpotlight();
    initCopy();
  });
})();
