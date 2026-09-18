/* Фотогалерея: лайтбокс на нативном <dialog> (фокус-трап и Esc из коробки). */
(function () {
  'use strict';
  var dlg = document.getElementById('lightbox');
  var img = document.getElementById('lb-img');
  var cap = document.getElementById('lb-cap');
  var count = document.getElementById('lb-count');
  var shots = Array.prototype.slice.call(document.querySelectorAll('#gallery .shot'));
  if (!dlg || !shots.length || typeof dlg.showModal !== 'function') return;
  var idx = 0;

  function show(i) {
    idx = (i + shots.length) % shots.length;
    var src = shots[idx].querySelector('img');
    img.src = src.getAttribute('src');
    img.alt = src.alt;
    cap.textContent = shots[idx].querySelector('figcaption').textContent;
    count.textContent = (idx + 1) + ' / ' + shots.length;
    // перезапуск анимации появления
    img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
  }

  shots.forEach(function (shot, i) {
    shot.querySelector('button').addEventListener('click', function () {
      show(i);
      dlg.showModal();
      document.body.style.overflow = 'hidden';
    });
  });
  dlg.addEventListener('close', function () {
    document.body.style.overflow = '';
    var btn = shots[idx].querySelector('button');
    if (btn) btn.focus();
  });
  document.getElementById('lb-close').addEventListener('click', function () { dlg.close(); });
  document.getElementById('lb-prev').addEventListener('click', function () { show(idx - 1); });
  document.getElementById('lb-next').addEventListener('click', function () { show(idx + 1); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.classList.contains('lightbox__stage')) dlg.close(); });
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { show(idx - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { show(idx + 1); e.preventDefault(); }
  });

  var x0 = null;
  dlg.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  dlg.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
    x0 = null;
  });
})();
