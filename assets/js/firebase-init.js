/* Общая инициализация Firebase (compat SDK подключается с gstatic с SRI).
   Этот конфиг публичный по дизайну Firebase: безопасность обеспечивают
   правила Firestore (firestore.rules), а не секретность ключа. */
(function () {
  'use strict';
  if (typeof firebase === 'undefined') { console.warn('Firebase SDK не загрузился'); return; }
  var app = firebase.initializeApp({
    apiKey: 'AIzaSyC7FCk4OkD2-vN6iGPG4F6VHo7NU1UHfmY',
    authDomain: 'egornetwork-5600d.firebaseapp.com',
    projectId: 'egornetwork-5600d',
    appId: '1:621304123553:web:b359df3267e27ce2dba0e0'
  });
  window.EN_FB = { app: app, auth: firebase.auth(), db: firebase.firestore() };
})();
