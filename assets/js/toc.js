/* Подсветка текущего раздела в оглавлении (license.html). */
(function () {
  'use strict';
  var links = document.querySelectorAll('#toc a');
  if (!links.length || !('IntersectionObserver' in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove('is-active'); });
      var a = byId[e.target.id];
      if (a) a.classList.add('is-active');
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
})();
