/* eslint-disable no-undef */
// ============================================================
//  firebase-messaging-sw.js
//  Service Worker untuk Firebase Cloud Messaging (FCM)
//  Cross-platform: PC Chrome/Firefox/Edge, Android, iOS 16.4+ PWA
// ============================================================

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Default Firebase config — di-init langsung agar SW background di Android & iOS PWA
// langsung siap menerima push notifikasi tanpa perlu menunggu tab aplikasi terbuka.
var defaultFirebaseConfig = {
  apiKey:            "AIzaSyCc6Xak3IOxGGnMUV_rWtl9GvMhSckZ9rE",
  authDomain:        "jaddhuman.firebaseapp.com",
  projectId:         "jaddhuman",
  storageBucket:     "jaddhuman.firebasestorage.app",
  messagingSenderId: "145796728174",
  appId:             "1:145796728174:web:bee07f5e776636bb972d7f"
};

var firebaseConfig = defaultFirebaseConfig;
var messagingInstance = null;
var isFirebaseInitialized = false;

// ─── Helper: deteksi platform ──────────────────────────────────
function getUserAgent() {
  try {
    return (self.navigator && self.navigator.userAgent) ? self.navigator.userAgent : '';
  } catch (e) {
    return '';
  }
}

// ─── Helper: Init Firebase (idempotent) ────────────────────────
function initFirebase(config) {
  if (isFirebaseInitialized) return true;
  var cfg = config || defaultFirebaseConfig;
  if (!cfg || !cfg.projectId) return false;

  try {
    if (firebase.apps.length === 0) {
      firebase.initializeApp(cfg);
    }
    messagingInstance = firebase.messaging();

    messagingInstance.onBackgroundMessage(function(payload) {
      handleBackgroundMessage(payload);
    });

    isFirebaseInitialized = true;
    console.log('[SW] Firebase Messaging berhasil diinisialisasi');
    return true;
  } catch (err) {
    console.error('[SW] Gagal init Firebase:', err);
    return false;
  }
}

// Inisialisasi awal saat SW pertama kali dimuat
initFirebase(defaultFirebaseConfig);

// ─── Helper: Ekstraksi field payload secara komprehensif ───────
function extractPayloadFields(payload) {
  if (!payload) return { title: '⏰ Jadhuman Notifikasi', body: 'Anda memiliki pesan pengingat baru.', data: {} };

  var notif        = payload.notification || {};
  var data         = payload.data || {};
  var webpushNotif = (payload.webpush && payload.webpush.notification) || {};

  var title = notif.title || webpushNotif.title || data.title || payload.title || '⏰ Jadhuman Notifikasi';
  var body  = notif.body  || webpushNotif.body  || data.body  || payload.body  || 'Anda memiliki pesan pengingat baru.';
  var icon  = notif.icon  || webpushNotif.icon  || data.icon  || '/assets/jadhuman.svg';
  var image = notif.image || webpushNotif.image || data.image || '';
  var tag   = notif.tag   || webpushNotif.tag   || data.tag   || 'jadhuman-notif';
  var targetUrl = data.targetUrl || data.link || (payload.fcmOptions && payload.fcmOptions.link) || '/input-aktivitas';

  return { title: title, body: body, icon: icon, image: image, tag: tag, targetUrl: targetUrl, data: data };
}

// ─── Handle background message ─────────────────────────────────
function handleBackgroundMessage(payload) {
  var extracted = extractPayloadFields(payload);
  var ua = getUserAgent();
  var isAndroid = /Android/i.test(ua);
  var isIOS     = /iPad|iPhone|iPod/i.test(ua);

  var notificationOptions = {
    body:               extracted.body,
    icon:               '/assets/jadhuman.svg',
    badge:              '/assets/jadhuman-monochrome-badge.svg',
    data:               Object.assign({}, extracted.data, { targetUrl: extracted.targetUrl }),
    tag:                extracted.tag,
    renotify:           true,
    silent:             false,
    vibrate:            [300, 100, 300, 100, 300],
    timestamp:          Date.now(),
    requireInteraction: true,
  };

  if (extracted.image) {
    notificationOptions.image = extracted.image;
  }

  if (isAndroid) {
    // Android: vibrasi kuat & instant visual pop-up
    notificationOptions.vibrate = [300, 100, 300, 100, 300];
    notificationOptions.actions = [
      { action: 'open',    title: 'Buka Aplikasi', icon: '/assets/jadhuman.svg' },
      { action: 'dismiss', title: 'Tutup',          icon: '/assets/jadhuman.svg' },
    ];
  } else if (!isIOS) {
    // Desktop Chrome/Edge/Firefox
    notificationOptions.vibrate = [200, 100, 200];
    notificationOptions.actions = [
      { action: 'open',    title: 'Buka Aplikasi' },
      { action: 'dismiss', title: 'Tutup' },
    ];
  }

  console.log('[SW] Showing notification:', { title: extracted.title, body: extracted.body, tag: extracted.tag, platform: isAndroid ? 'Android' : isIOS ? 'iOS' : 'Desktop' });
  return self.registration.showNotification(extracted.title, notificationOptions);
}

// ─── Message dari client: terima update Firebase config ───────
self.addEventListener('message', function(event) {
  if (!event || !event.data) return;

  if (event.data.type === 'FIREBASE_CONFIG') {
    firebaseConfig = event.data.config || defaultFirebaseConfig;
    initFirebase(firebaseConfig);
  }
});

// ─── Push event langsung (Garansi 100% Notifikasi Muncul) ─────
self.addEventListener('push', function(event) {
  if (!event) return;

  if (!isFirebaseInitialized) {
    initFirebase(firebaseConfig);
  }

  var payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      try {
        payload = { notification: { title: '⏰ Jadhuman Notifikasi', body: event.data.text() } };
      } catch (e2) {
        payload = { notification: { title: '⏰ Jadhuman Notifikasi', body: 'Ada notifikasi baru' } };
      }
    }
  }

  event.waitUntil(handleBackgroundMessage(payload));
});

// ─── Notification click ────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  if (!event) return;
  event.notification.close();

  if (event.action === 'dismiss') return;

  var targetUrl = '/input-aktivitas';
  try {
    if (event.notification.data && event.notification.data.targetUrl) {
      targetUrl = event.notification.data.targetUrl;
    }
  } catch (e) { /* fallback */ }

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url && client.url.indexOf(self.location.origin) !== -1) {
            return client.navigate
              ? client.navigate(self.location.origin + targetUrl).then(function(c) { return c && c.focus ? c.focus() : null; })
              : client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(self.location.origin + targetUrl);
        }
      })
  );
});

// ─── Notification close ────────────────────────────────────────
self.addEventListener('notificationclose', function() {
  // Opsional: analytics
});

// ─── Install ───────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Install event — skipWaiting');
  self.skipWaiting();
});

// ─── Activate ──────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate event — claim clients');
  event.waitUntil(
    self.clients.claim().then(function() {
      console.log('[SW] Clients claimed');
    })
  );
});
