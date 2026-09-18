/* Воркер видео-компрессора. Все сторонние файлы ffmpeg.wasm грузятся
   с проверкой Subresource Integrity (fetch + integrity): если CDN отдаст
   хоть байт другого кода — загрузка упадёт, а не выполнится. */
'use strict';

var CDN = 'https://cdn.jsdelivr.net/npm/';
var FILES = {
  wrapper: { url: CDN + '@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js', integrity: 'sha384-m5or9sW5FUT2WQbj3UthGceVpwo9zSgHKdCugYKHl19lyXPvwO/oQcmq8Fw0FfaA' },
  core: { url: CDN + '@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js', integrity: 'sha384-BeUhGK5N9KTyO9NFKUSUBTxwvxLI4EZFbynF9mLtj73/2DqmPqGLk6EJ9ZU+R+6J' },
  wasm: { url: CDN + '@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.wasm', integrity: 'sha384-vAbQ21XJMfp9RyAaryzB4ciuXISd636UpiZYr7vDBAuX+NmAYvnQNdvA3RubvdHH' }
};

var ffmpeg = null;

function fetchVerified(file) {
  return fetch(file.url, { integrity: file.integrity, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' при загрузке ' + file.url);
      return r.arrayBuffer();
    });
}

function toBlobUrl(buf, type) {
  return URL.createObjectURL(new Blob([buf], { type: type }));
}

async function load() {
  if (ffmpeg) return ffmpeg;
  status('Загрузка и проверка FFmpeg.wasm (~25 МБ)…');
  var bufs = await Promise.all([fetchVerified(FILES.wrapper), fetchVerified(FILES.core), fetchVerified(FILES.wasm)]);
  // Обёртка 0.11 ищет document.baseURI, которого в воркере нет — патчим
  // уже ПОСЛЕ проверки целостности исходника.
  var wrapperSrc = new TextDecoder().decode(bufs[0]).replace(/document\.baseURI/g, 'self.location.href');
  importScripts(toBlobUrl(wrapperSrc, 'application/javascript'));
  var coreUrl = toBlobUrl(bufs[1], 'application/javascript');
  var wasmUrl = toBlobUrl(bufs[2], 'application/wasm');
  ffmpeg = self.FFmpeg.createFFmpeg({ log: false, corePath: coreUrl, wasmPath: wasmUrl, workerPath: coreUrl, mainName: 'main' });
  ffmpeg.setProgress(function (p) { self.postMessage({ type: 'progress', ratio: p.ratio }); });
  await ffmpeg.load();
  return ffmpeg;
}

function status(text) { self.postMessage({ type: 'status', text: text }); }

self.onmessage = async function (e) {
  var d = e.data || {};
  if (d.type !== 'compress') return;
  var crf = Math.min(35, Math.max(16, parseInt(d.crf, 10) || 26));
  try {
    var ff = await load();
    status('Чтение файла…');
    ff.FS('writeFile', 'input', new Uint8Array(d.buffer));
    status('Кодирование…');
    await ff.run('-i', 'input', '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'output.mp4');
    var out = ff.FS('readFile', 'output.mp4');
    var copy = new Uint8Array(out);
    ff.FS('unlink', 'input');
    ff.FS('unlink', 'output.mp4');
    self.postMessage({ type: 'done', buffer: copy.buffer }, [copy.buffer]);
  } catch (err) {
    var msg = (err && err.message) || String(err);
    if (/integrity|digest/i.test(msg) || err instanceof TypeError) msg = 'Файлы FFmpeg не прошли проверку целостности или недоступны. Попробуйте позже.';
    else if (/Invalid data found/.test(msg)) msg = 'Формат не поддерживается или файл повреждён.';
    else if (/ENOMEM|memory/i.test(msg)) msg = 'Не хватает памяти. Попробуйте файл поменьше или закройте лишние вкладки.';
    self.postMessage({ type: 'error', message: msg });
  }
};
