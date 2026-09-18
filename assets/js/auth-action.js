/* Обработчик ссылок из писем Firebase Auth (подтверждение почты, сброс пароля).
   Одноразовый код применяется ТОЛЬКО по нажатию кнопки: почтовые сканеры,
   которые заранее «открывают» ссылки из писем, кнопки не нажимают и код не сжигают. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var mode = params.get('mode');
  var code = params.get('oobCode');
  // Код больше не нужен в адресной строке/истории.
  if (code) history.replaceState(null, '', location.pathname);

  function set(title, text) { $('act-title').textContent = title; $('act-text').textContent = text || ''; }
  function status(text, kind) { var n = $('act-status'); n.textContent = text; n.className = 'status' + (kind ? ' is-' + kind : ''); }
  function done(title, text) { set(title, text); $('act-verify').hidden = true; $('act-reset').hidden = true; $('act-back').hidden = false; status(''); }
  function fail(e) {
    var c = (e && e.code) || '';
    if (/expired-action-code|invalid-action-code/.test(c)) {
      done('Ссылка устарела', 'Её уже использовали или срок истёк. Если почта уже подтверждена — просто войдите. Иначе запросите новое письмо в Муравейнике.');
    } else if (/weak-password/.test(c)) {
      status('Пароль слишком простой (минимум 8 символов).', 'err');
    } else {
      status('Ошибка: ' + (c || 'неизвестно'), 'err');
    }
  }

  var fb = window.EN_FB;
  if (!fb || !code) { done('Нет кода', 'Откройте ссылку из письма целиком.'); return; }
  var auth = fb.auth;

  if (mode === 'verifyEmail') {
    $('act-eyebrow').textContent = 'Подтверждение почты';
    set('Подтвердите почту', 'Нажмите кнопку, чтобы завершить регистрацию в Муравейнике.');
    $('act-verify').hidden = false;
    $('act-verify-btn').addEventListener('click', function () {
      var btn = this; btn.disabled = true;
      auth.applyActionCode(code).then(function () {
        done('Почта подтверждена ✓', 'Вернитесь в Муравейник и нажмите «Я подтвердил» (или просто обновите страницу).');
      }, function (e) { btn.disabled = false; fail(e); });
    });
  } else if (mode === 'resetPassword') {
    $('act-eyebrow').textContent = 'Сброс пароля';
    auth.verifyPasswordResetCode(code).then(function () {
      set('Новый пароль', 'Придумайте новый пароль (минимум 8 символов). Ключи шифрования от пароля не зависят — переписка сохранится, но на новых устройствах понадобится код восстановления.');
      $('act-reset').hidden = false;
    }, fail);
    $('act-reset').addEventListener('submit', function (e) {
      e.preventDefault();
      var p1 = $('act-pass').value, p2 = $('act-pass2').value;
      if (p1.length < 8) { status('Минимум 8 символов.', 'err'); return; }
      if (p1 !== p2) { status('Пароли не совпадают.', 'err'); return; }
      $('act-reset-btn').disabled = true;
      auth.confirmPasswordReset(code, p1).then(function () {
        $('act-pass').value = ''; $('act-pass2').value = '';
        done('Пароль изменён ✓', 'Теперь можно войти с новым паролем.');
      }, function (err) { $('act-reset-btn').disabled = false; fail(err); });
    });
  } else if (mode === 'recoverEmail') {
    $('act-eyebrow').textContent = 'Восстановление почты';
    set('Вернуть прежнюю почту?', 'Кто-то сменил почту вашего аккаунта. Нажмите, чтобы вернуть прежнюю, и сразу смените пароль.');
    $('act-verify').hidden = false;
    $('act-verify-btn').textContent = 'Вернуть почту';
    $('act-verify-btn').addEventListener('click', function () {
      auth.applyActionCode(code).then(function () { done('Почта возвращена ✓', 'Обязательно смените пароль через «Забыли пароль?».'); }, fail);
    });
  } else {
    done('Неизвестная ссылка', '');
  }
})();
