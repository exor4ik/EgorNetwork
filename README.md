# EgorNetwork

Сайт инди-студии EgorNetwork. Чистая статика под GitHub Pages: без сборки, без зависимостей в рантайме, кроме Firebase (блог и мини-игры).

## Структура

| Путь | Что это |
|---|---|
| `index.html`, `games.html`, `useful.html`, … | страницы сайта |
| `minis.html` | мини-игры (ретро-консоль, 7 игр, рекорды, онлайн-дуэли) |
| `coridore.html` | «АРХИВ 014» (скрытая страница, в терминале на главной: `archive 014`) |
| `assets/css/site.css` | дизайн-система |
| `assets/js/site.js` | шапка/подвал/навигация/анимации (строит DOM без innerHTML) |
| `assets/js/firebase-init.js` | конфиг Firebase (публичный по дизайну) |
| `assets/vendor/three/` | локальная копия three.js |
| `firestore.rules` | правила Firestore |

## Безопасность

- **CSP** в `<meta>` на каждой странице. Статические страницы: только `'self'`, без inline-скриптов и стилей, плюс **Trusted Types** (`innerHTML` физически не работает).
- **SRI**: Firebase SDK с gstatic подключается с `integrity` + `crossorigin`. ffmpeg.wasm для компрессора видео качается воркером через `fetch(..., { integrity })`.
- Все внешние ссылки `target="_blank"` — с `rel="noopener noreferrer"`; `<meta name="referrer" content="no-referrer">` везде.
- Пользовательские данные (посты, ники) выводятся только через `textContent`.
- Мини-игры: анонимный вход Firebase, наружу виден только ник, который игрок ввёл сам.

## Что сделать вручную в Firebase Console

1. Проект: `egornetwork-5600d`. При смене проекта обновите `assets/js/firebase-init.js` и домен в `frame-src` CSP (`blog.html`, `minis.html`).
2. Задеплойте правила: `firebase deploy --only firestore:rules`.
3. Authentication → Sign-in method: включите **Anonymous**; **Google** можно выключить.
4. Админ блога: создайте пользователя (Email/Password) в Authentication, затем в Firestore документ `users/{его uid}` с полем `role: "admin"` (строка).
5. Если переносите старые посты — «Почистить метаданные старых постов» в админке уберёт `author`/`authorUid`.
6. Google Cloud → APIs & Services → Credentials: ограничьте API-ключ по HTTP referrer доменом сайта. По желанию включите App Check.

## Локальный запуск

```bash
python3 -m http.server 8765
```
