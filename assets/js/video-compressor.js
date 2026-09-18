/* Компрессор видео: UI. Вся работа — в assets/js/video-worker.js. */
(function () {
  'use strict';
  var WORKER_URL = 'assets/js/video-worker.js';
  var MAX_MB = 400;
  var $ = function (id) { return document.getElementById(id); };
  var input = $('vc-input'), drop = $('vc-drop'), fileLbl = $('vc-file'), crf = $('vc-crf'), crfVal = $('vc-crf-val');
  var go = $('vc-go'), cancel = $('vc-cancel'), bar = $('vc-bar'), st = $('vc-status'), dl = $('vc-download');
  var worker = null, resultUrl = null;

  // Trusted Types: разрешаем ровно один URL — наш воркер.
  var tt = window.trustedTypes && window.trustedTypes.createPolicy('en-worker', {
    createScriptURL: function (u) { if (u === WORKER_URL) return u; throw new TypeError('blocked worker url'); }
  });

  function setStatus(text, kind) { st.textContent = text; st.className = 'status' + (kind ? ' is-' + kind : ''); }
  function mb(bytes) { return (bytes / 1048576).toFixed(1) + ' МБ'; }
  function busy(b) { go.disabled = b || !input.files.length; cancel.hidden = !b; input.disabled = b; }
  function kill() { if (worker) { worker.terminate(); worker = null; } }

  crf.addEventListener('input', function () { crfVal.textContent = crf.value; });

  function pick() {
    var f = input.files[0];
    dl.hidden = true; bar.style.width = '0%';
    if (!f) { fileLbl.textContent = 'Перетащите видео сюда или нажмите, чтобы выбрать'; go.disabled = true; return; }
    fileLbl.textContent = f.name + ' · ' + mb(f.size);
    go.disabled = false;
    if (f.size > MAX_MB * 1048576) {
      setStatus('Файл больше ' + MAX_MB + ' МБ — может не хватить памяти. Можно попробовать всё равно.', 'err');
      go.textContent = 'Сжать всё равно';
    } else {
      setStatus('Готово к сжатию.');
      go.textContent = 'Сжать видео';
    }
  }
  input.addEventListener('change', pick);
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('is-over'); }); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; pick(); }
  });

  cancel.addEventListener('click', function () { kill(); busy(false); bar.style.width = '0%'; setStatus('Отменено.'); });

  go.addEventListener('click', function () {
    var f = input.files[0];
    if (!f) return;
    busy(true); dl.hidden = true; bar.style.width = '0%';
    setStatus('Подготовка…');
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    f.arrayBuffer().then(function (buf) {
      kill();
      worker = new Worker(tt ? tt.createScriptURL(WORKER_URL) : WORKER_URL);
      worker.onmessage = function (e) {
        var d = e.data;
        if (d.type === 'status') setStatus(d.text);
        else if (d.type === 'progress') {
          var pct = Math.max(0, Math.min(100, Math.round(d.ratio * 100)));
          bar.style.width = pct + '%'; setStatus('Кодирование: ' + pct + '%');
        } else if (d.type === 'done') {
          var blob = new Blob([d.buffer], { type: 'video/mp4' });
          resultUrl = URL.createObjectURL(blob);
          dl.href = resultUrl;
          dl.download = 'compressed_' + f.name.replace(/\.[^/.]+$/, '') + '.mp4';
          dl.textContent = 'Скачать (' + mb(blob.size) + ')';
          dl.hidden = false;
          bar.style.width = '100%';
          setStatus('Готово: ' + mb(f.size) + ' → ' + mb(blob.size), 'ok');
          busy(false); kill();
        } else if (d.type === 'error') {
          setStatus('Ошибка: ' + d.message, 'err'); bar.style.width = '0%'; busy(false); kill();
        }
      };
      worker.onerror = function () { setStatus('Не удалось запустить FFmpeg. Обновите страницу.', 'err'); busy(false); kill(); };
      worker.postMessage({ type: 'compress', buffer: buf, crf: crf.value }, [buf]);
    }, function () { setStatus('Не удалось прочитать файл.', 'err'); busy(false); });
  });
})();
