/* Компрессор аудио: Web Audio API + MediaRecorder (Opus). Всё локально. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var input = $('ac-input'), drop = $('ac-drop'), fileLbl = $('ac-file'), size = $('ac-size'), sizeVal = $('ac-size-val');
  var go = $('ac-go'), bar = $('ac-bar'), st = $('ac-status'), dl = $('ac-download');
  var resultUrl = null;

  function setStatus(text, kind) { st.textContent = text; st.className = 'status' + (kind ? ' is-' + kind : ''); }
  function mb(bytes) { return (bytes / 1048576).toFixed(2) + ' МБ'; }

  size.addEventListener('input', function () { sizeVal.textContent = size.value; });

  function pick() {
    var f = input.files[0];
    dl.hidden = true; bar.style.width = '0%';
    go.disabled = !f;
    fileLbl.textContent = f ? f.name + ' · ' + mb(f.size) : 'Перетащите аудио сюда или нажмите, чтобы выбрать';
    setStatus(f ? 'Готово к сжатию.' : 'Выберите аудио для начала.');
  }
  input.addEventListener('change', pick);
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('is-over'); }); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; pick(); }
  });

  go.addEventListener('click', async function () {
    var f = input.files[0];
    if (!f) return;
    go.disabled = true; input.disabled = true; dl.hidden = true;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    try {
      var res = await compress(f, parseFloat(size.value), function (pct, text) { bar.style.width = pct + '%'; if (text) setStatus(text); });
      resultUrl = URL.createObjectURL(res.blob);
      dl.href = resultUrl;
      dl.download = 'compressed_' + f.name.replace(/\.[^/.]+$/, '') + '.webm';
      dl.textContent = 'Скачать (' + mb(res.blob.size) + ')';
      dl.hidden = false;
      bar.style.width = '100%';
      setStatus('Готово: ' + mb(f.size) + ' → ' + mb(res.blob.size) + ' (' + res.kbps + ' кбит/с)', 'ok');
    } catch (err) {
      setStatus('Ошибка: ' + err.message, 'err');
      bar.style.width = '0%';
    } finally {
      go.disabled = false; input.disabled = false;
    }
  });

  async function compress(file, targetMB, onProgress) {
    var targetBytes = targetMB * 1048576;
    if (file.size <= targetBytes) throw new Error('файл уже меньше целевого размера');
    if (typeof MediaRecorder === 'undefined') throw new Error('браузер не поддерживает MediaRecorder');
    onProgress(5, 'Декодирование…');
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var audio;
    try { audio = await ctx.decodeAudioData(await file.arrayBuffer()); }
    catch (e) { ctx.close(); throw new Error('не удалось декодировать — формат не поддерживается'); }
    var duration = audio.duration;
    if (!(duration > 0)) { ctx.close(); throw new Error('пустое аудио'); }
    var bitrate = Math.max(16000, Math.min(512000, Math.round(targetBytes * 8 / duration)));
    var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    var dest = ctx.createMediaStreamDestination();
    var src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(dest);
    var rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: bitrate });
    var chunks = [];
    return new Promise(function (resolve, reject) {
      var t0 = performance.now();
      var timer = setInterval(function () {
        var pct = Math.min(95, 10 + Math.round((performance.now() - t0) / 1000 / duration * 85));
        onProgress(pct, 'Кодирование в реальном времени: ' + pct + '%');
      }, 250);
      rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        clearInterval(timer); ctx.close();
        resolve({ blob: new Blob(chunks, { type: mime }), kbps: Math.round(bitrate / 1000) });
      };
      rec.onerror = function (e) { clearInterval(timer); ctx.close(); reject(new Error((e.error && e.error.message) || 'ошибка записи')); };
      src.onended = function () { setTimeout(function () { rec.stop(); }, 100); };
      rec.start();
      src.start();
    });
  }
})();
