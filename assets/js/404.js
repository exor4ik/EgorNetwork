/* 404: терминал с путём (строго через textContent — раньше тут была XSS
   через location.pathname → innerHTML) и пасхалка по кликам. */
(function () {
  'use strict';
  var el = window.EN.el;
  var term = document.getElementById('err-term');
  var path = decodeURIComponentSafe(location.pathname).slice(0, 120);

  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function line(text, cls) { term.appendChild(el('div', { class: cls || '', text: text })); }

  line('GET ' + path, 't-in');
  line('→ 404 Not Found', 't-err');
  line('stack: [GitHub Pages → egornetwork → 404]', 't-dim');
  setTimeout(function () { line('suggest --fix', 't-in'); }, 700);
  setTimeout(function () { line('→ cd ~ && ./start_over.sh ✓', 't-ok'); }, 1300);

  var code = document.getElementById('err-code');
  var span = code.querySelector('span');
  var hint = document.getElementById('err-hint');
  var steps = [
    ['403', '// [1/4] продолжай…'], ['418', '// [2/4] я чайник?'],
    ['500', '// [3/4] почти…'], ['200', '// status: 200 OK — ты нашёл секрет!']
  ];
  var n = 0;
  code.addEventListener('click', function () {
    if (n >= steps.length) return;
    var s = steps[n++];
    span.textContent = s[0];
    span.setAttribute('data-t', s[0]);
    hint.textContent = s[1];
    if (s[0] === '200') { span.classList.add('accent'); code.style.cursor = 'default'; }
  });
})();
