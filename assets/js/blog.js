/* Блог: чтение постов из Firestore + панель админа.
   Весь пользовательский контент — только через textContent.
   Права админа проверяют ПРАВИЛА Firestore (users/{uid}.role == 'admin');
   клиентская проверка лишь прячет/показывает панель. */
(function () {
  'use strict';
  var el = window.EN.el;
  var fb = window.EN_FB;
  var list = document.getElementById('posts');
  var panel = document.getElementById('admin-panel');
  var isAdmin = false;

  function status(id, text, kind) {
    var n = document.getElementById(id);
    n.textContent = text; n.className = 'status' + (kind ? ' is-' + kind : '');
  }

  function empty(text) {
    list.textContent = '';
    list.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted', text: text })));
  }

  if (!fb) { empty('Не удалось подключиться к базе. Попробуйте позже.'); return; }
  var posts = fb.db.collection('posts');

  function fmtDate(ts) {
    if (!ts || typeof ts.toDate !== 'function') return '';
    return ts.toDate().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function render(snap) {
    if (snap.empty && snap.metadata.fromCache) return; // ждём ответа сервера
    loaded = true;
    list.textContent = '';
    if (snap.empty) { empty('Постов пока нет.'); return; }
    snap.forEach(function (doc) {
      var d = doc.data();
      var title = typeof d.title === 'string' ? d.title : '';
      var text = typeof d.text === 'string' ? d.text : '';
      var art = el('article', { class: 'card post' }, [
        el('time', { text: fmtDate(d.createdAt) }),
        el('h2', { text: title }),
        el('div', { class: 'post__body', text: text })
      ]);
      if (isAdmin) {
        var del = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Удалить' });
        del.addEventListener('click', function () {
          if (!confirm('Удалить пост «' + title + '»?')) return;
          posts.doc(doc.id).delete().catch(function (e) { alert('Ошибка: ' + e.message); });
        });
        art.appendChild(el('div', { class: 'post__admin' }, del));
      }
      list.appendChild(art);
    });
  }

  var loaded = false;
  setTimeout(function () {
    if (!loaded) empty('База блога сейчас недоступна. Новости — в нашем Telegram.');
  }, 12000);

  var unsub = null;
  function subscribe() {
    if (unsub) unsub();
    unsub = posts.orderBy('createdAt', 'desc').limit(30).onSnapshot(render, function () {
      empty('Не удалось загрузить посты.');
    });
  }
  subscribe();

  /* ── Админ ─────────────────────────────────────────────────────────── */
  fb.auth.onAuthStateChanged(function (user) {
    isAdmin = false;
    panel.hidden = true;
    if (!user || user.isAnonymous) { subscribe(); return; }
    fb.db.collection('users').doc(user.uid).get().then(function (s) {
      isAdmin = s.exists && s.data().role === 'admin';
      panel.hidden = !isAdmin;
      document.getElementById('admin-login').hidden = isAdmin;
      if (!isAdmin) status('login-status', 'Вход выполнен, но прав администратора нет.', 'err');
      subscribe();
    }).catch(function () { subscribe(); });
  });

  document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('login-email').value.trim();
    var pass = document.getElementById('login-pass').value;
    if (!email || !pass) { status('login-status', 'Заполните оба поля.', 'err'); return; }
    status('login-status', 'Вход…');
    fb.auth.signInWithEmailAndPassword(email, pass).then(function () {
      document.getElementById('login-pass').value = '';
      status('login-status', '');
    }, function () {
      status('login-status', 'Неверный email или пароль.', 'err'); // без подробностей — не помогаем перебору
    });
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    fb.auth.signOut();
    document.getElementById('admin-login').hidden = false;
  });

  document.getElementById('post-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = document.getElementById('post-title').value.trim();
    var text = document.getElementById('post-text').value.trim();
    if (!title || !text) { status('admin-status', 'Нужны заголовок и текст.', 'err'); return; }
    var btn = document.getElementById('post-submit');
    btn.disabled = true;
    // Только эти три поля — никаких author/email в публичном документе.
    posts.add({ title: title, text: text, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function () {
      document.getElementById('post-title').value = '';
      document.getElementById('post-text').value = '';
      status('admin-status', 'Опубликовано.', 'ok');
    }, function (err) {
      status('admin-status', 'Ошибка: ' + err.message, 'err');
    }).then(function () { btn.disabled = false; });
  });

  // Старые посты содержали author (displayName/email!) и authorUid —
  // они публично читались через API. Эта кнопка вычищает их.
  document.getElementById('scrub-btn').addEventListener('click', function () {
    if (!confirm('Удалить поля author, authorUid и reactions из всех постов?')) return;
    var del = firebase.firestore.FieldValue.delete();
    status('admin-status', 'Чищу…');
    posts.get().then(function (snap) {
      var batch = fb.db.batch(), n = 0;
      snap.forEach(function (doc) {
        var d = doc.data();
        if ('author' in d || 'authorUid' in d || 'reactions' in d) {
          batch.update(doc.ref, { author: del, authorUid: del, reactions: del });
          n++;
        }
      });
      return n ? batch.commit().then(function () { return n; }) : 0;
    }).then(function (n) {
      status('admin-status', n ? 'Почищено постов: ' + n : 'Чистить нечего — всё уже чисто.', 'ok');
    }, function (err) { status('admin-status', 'Ошибка: ' + err.message, 'err'); });
  });
})();
