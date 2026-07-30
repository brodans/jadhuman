// ============================================================
//  src/lib/fcmService.ts
//  Firebase Cloud Messaging (FCM) Client Service
//  Cross-platform: PC, Android Chrome, iOS Safari 16.4+
// ============================================================

import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import type { Messaging } from 'firebase/messaging';
import { db } from './firebase';
import { doc, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';

const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const FCM_TOKENS_COLLECTION = 'jadhuman_fcm_tokens';

// Singleton messaging instance
let messaging: Messaging | null = null;
let isInitialized = false;
let foregroundListenerSet = false;

// Device info interface
interface DeviceInfo {
  token: string;
  tokenId: string;
  deviceInfo: string;
  platform: string;
  browser: string;
  userAgent: string;
  registeredAt: string;
  lastSeen: string;
}

// ─── Platform detection ──────────────────────────────────────────

export function getPlatformInfo() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isChrome = /Chrome/.test(ua) && !/Edge/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isEdge = /Edge|Edg\//.test(ua);

  // iOS Safari 16.4+ supports Web Push & SW
  const iosSafariVersion = (() => {
    if (!isIOS) return 0;
    // Cek versi iOS dari userAgent — format "OS 16_4_1" atau "Version/16.4"
    const osMatch = ua.match(/OS (\d+)_(\d+)/);
    if (osMatch) return parseInt(osMatch[1], 10);
    const verMatch = ua.match(/Version\/(\d+)/);
    return verMatch ? parseInt(verMatch[1], 10) : 0;
  })();

  const supportsPush =
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  // iOS requires PWA (installed as standalone) for push notifications
  // navigator.standalone = iOS Safari standalone mode
  // display-mode: standalone = installed PWA
  const isInstalledPWA =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  // iOS 16.4+ = mendukung Web Push, TAPI hanya saat diinstall sebagai PWA
  // Jika bukan PWA, Notification API tidak akan tersedia sama sekali di iOS
  const iOSPushSupported = isIOS && iosSafariVersion >= 16 && supportsPush;

  return {
    isIOS, isAndroid, isSafari, isChrome, isFirefox, isEdge,
    iosSafariVersion, supportsPush, isInstalledPWA,
    iOSPushSupported,
  };
}

// ─── FCM Init ────────────────────────────────────────────────────

/**
 * Inisialisasi Firebase Messaging
 * Safe to call multiple times (no-op after first init)
 */
export function initializeFCM(): boolean {
  if (isInitialized) return true;

  try {
    messaging = getMessaging();
    isInitialized = true;
    return true;
  } catch (err) {
    // FCM might throw if not supported (e.g. old iOS, FF without SW)
    console.warn('[FCM] Gagal inisialisasi:', err);
    return false;
  }
}

// ─── Permission ──────────────────────────────────────────────────

/**
 * Request notification permission
 * Handles both callback-style (old) and Promise-style (modern)
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';

  try {
    // Modern: returns Promise
    const result = await Notification.requestPermission();
    return result;
  } catch {
    // Fallback: callback style (old Safari)
    return new Promise((resolve) => {
      Notification.requestPermission((perm) => resolve(perm));
    });
  }
}

// ─── Service Worker ──────────────────────────────────────────────

/**
 * Register Service Worker dengan retry dan config propagation
 */
async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    // Register (or get existing) SW
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
      updateViaCache: 'none', // always check for SW updates
    });

    // Wait until active
    await navigator.serviceWorker.ready;

    // Propagate Firebase config to SW
    const firebaseConfig = {
      apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId:             import.meta.env.VITE_FIREBASE_APP_ID,
    };

    const target = registration.active ?? registration.installing ?? registration.waiting;
    if (target) {
      target.postMessage({ type: 'FIREBASE_CONFIG', config: firebaseConfig });
    }

    return registration;
  } catch (err) {
    console.warn('[FCM] SW registration gagal:', err);
    return null;
  }
}

// ─── Token ───────────────────────────────────────────────────────

/**
 * Dapatkan FCM token, return null jika tidak didukung
 */
export async function getFCMToken(): Promise<string | null> {
  if (!messaging || !VAPID_KEY) return null;

  try {
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') return null;

    const registration = await registerServiceWorker();
    if (!registration) return null;

    const tokenPromise = getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('Koneksi FCM timeout. Periksa jaringan internet Anda.')), 10000)
    );

    const token = await Promise.race([tokenPromise, timeoutPromise]);
    return token || null;
  } catch (err: any) {
    console.warn('[FCM] getFCMToken gagal (mungkin tidak didukung atau timeout):', err?.code || err?.message);
    return null;
  }
}

// ─── Firestore ───────────────────────────────────────────────────

/**
 * Simpan FCM token ke Firestore (Multi-device per user)
 * Menggunakan API backend /api/register-device (Admin SDK) untuk keandalan maksimal
 */
export async function saveFCMTokenToFirestore(userId: string, token: string): Promise<boolean> {
  try {
    const ua = navigator.userAgent;
    const { isIOS, isAndroid, isSafari, isChrome, isEdge, isFirefox } = getPlatformInfo();

    let browser = 'Browser';
    if (isEdge)         browser = 'Edge';
    else if (isChrome)  browser = 'Chrome';
    else if (isFirefox) browser = 'Firefox';
    else if (isSafari)  browser = 'Safari';

    let os = 'Unknown';
    if (isIOS) os = 'iOS';
    else if (isAndroid) os = 'Android';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    const baseLabel = `${browser} on ${os}`;

    // Coba API backend dulu (sangat cepat, bebas masalah rules Firestore client)
    try {
      const res = await fetch('/api/register-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          token,
          deviceInfo: baseLabel,
          platform: os,
          browser,
          userAgent: ua,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          console.log(`[FCM] Device registered via server API for ${userId}`);
          return true;
        }
      }
    } catch (e) {
      console.warn('[FCM] API register-device error, mencoba client Firestore fallback:', e);
    }

    const { getDoc } = await import('firebase/firestore');
    const docRef = doc(db, FCM_TOKENS_COLLECTION, userId);

    const userDoc = await getDoc(docRef);
    const now     = new Date().toISOString();

    let devices: DeviceInfo[] = [];
    let createdAt             = serverTimestamp();

    if (userDoc.exists()) {
      const data = userDoc.data();
      devices   = (data.devices || []) as DeviceInfo[];
      createdAt = data.createdAt ?? serverTimestamp();
    }

    // Cek token/tokenId sudah ada → update entry tersebut, jangan buat duplicate
    const tokenIdShort = token.substring(0, 20);
    const existingIdx = devices.findIndex((d) => d.token === token || (d.tokenId && d.tokenId.startsWith(tokenIdShort)));

    if (existingIdx >= 0) {
      devices[existingIdx] = {
        ...devices[existingIdx],
        token,
        tokenId: tokenIdShort + '...',
        lastSeen: now,
        deviceInfo: baseLabel,
        platform: os,
        browser,
      };
    } else {
      const deviceInfo: DeviceInfo = {
        token,
        tokenId: tokenIdShort + '...',
        deviceInfo: baseLabel,
        platform: os,
        browser,
        userAgent: ua.substring(0, 150),
        registeredAt: now,
        lastSeen: now,
      };
      devices.push(deviceInfo);
    }

    // Deduplikasi array devices agar tidak ada token / tokenId yang sama berulang
    const uniqueMap = new Map<string, DeviceInfo>();
    devices.forEach((d) => {
      const key = d.token || d.tokenId;
      if (key) uniqueMap.set(key, d);
    });
    devices = Array.from(uniqueMap.values());

    // Overwrite dokumen dengan struktur bersih
    await setDoc(docRef, {
      userId,
      devices,
      createdAt,
      updatedAt: serverTimestamp(),
    });

    console.log(`[FCM] Device registered for userId: ${userId}, device: ${baseLabel}`);
    return true;
  } catch (err) {
    console.error('[FCM] Gagal simpan token:', err);
    return false;
  }
}

// ─── Delete token (unsubscribe) ──────────────────────────────────

/**
 * Hapus device tertentu dari array devices user di Firestore.
 * Jika token yang dihapus adalah token device INI (browser ini),
 * juga hapus FCM token dari SW/browser cache agar browser tahu perlu daftar ulang.
 */
export async function deleteFCMDeviceFromFirestore(userId: string, token: string): Promise<boolean> {
  try {
    // 1. Coba hapus lewat API backend dulu
    try {
      const res = await fetch('/api/delete-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          await _deleteLocalFCMToken();
          return true;
        }
      }
    } catch (e) {
      console.warn('[FCM] API delete-device error, mencoba client fallback:', e);
    }

    // 2. Fallback client-side Firestore SDK
    const { getDoc, updateDoc, arrayRemove } = await import('firebase/firestore');
    const docRef = doc(db, FCM_TOKENS_COLLECTION, userId);

    const userDoc = await getDoc(docRef);
    if (!userDoc.exists()) return false;

    const data = userDoc.data();
    const devices = data.devices || [];
    const deviceToRemove = devices.find((d: DeviceInfo) => d.token === token);

    if (deviceToRemove) {
      await updateDoc(docRef, {
        devices: arrayRemove(deviceToRemove),
        updatedAt: serverTimestamp(),
      });
      await _deleteLocalFCMToken();
      return true;
    }
    return false;
  } catch (err) {
    console.error('[FCM] Gagal hapus device:', err);
    return false;
  }
}

/**
 * Hapus semua devices untuk userId tertentu (disable notifikasi sepenuhnya)
 * + hapus token lokal browser ini
 */
export async function deleteAllUserFCMTokens(userId: string): Promise<boolean> {
  try {
    _deleteLocalFCMToken().catch(() => {});

    // Coba hapus via API backend dulu
    try {
      const res = await fetch('/api/delete-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, deleteAll: true }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) return true;
      }
    } catch (e) {
      console.warn('[FCM] API deleteAll error, fallback client SDK:', e);
    }

    await deleteDoc(doc(db, FCM_TOKENS_COLLECTION, userId));
    return true;
  } catch (err) {
    console.error('[FCM] Gagal hapus semua devices user:', err);
    return false;
  }
}

/**
 * Hapus FCM token dari SW/browser cache (internal helper).
 * Setelah ini, getToken() akan generate token baru.
 * Non-fatal — jika gagal, token lama tetap di SW tapi tidak ada di Firestore.
 */
async function _deleteLocalFCMToken(): Promise<void> {
  try {
    if (!messaging) return;
    const { deleteToken } = await import('firebase/messaging');
    await deleteToken(messaging);
    console.log('[FCM] Local FCM token deleted from browser cache');
  } catch (err) {
    // Non-fatal: mungkin token sudah tidak ada
    console.warn('[FCM] Gagal hapus local token (non-fatal):', err);
  }
}

/**
 * Mendapatkan semua devices yang terdaftar untuk userId
 */
export async function getUserDevices(userId: string): Promise<DeviceInfo[]> {
  try {
    const { getDoc } = await import('firebase/firestore');
    const docRef = doc(db, FCM_TOKENS_COLLECTION, userId);
    const userDoc = await getDoc(docRef);
    
    if (!userDoc.exists()) {
      return [];
    }
    
    const data = userDoc.data();
    if (Array.isArray(data.devices)) {
      return data.devices;
    }
    if (data.token) {
      return [{
        token: data.token,
        tokenId: data.token.substring(0, 20) + '...',
        deviceInfo: data.deviceInfo || 'Legacy Device',
        platform: data.platform || '',
        browser: data.browser || '',
        userAgent: '',
        registeredAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : new Date().toISOString(),
        lastSeen: data.updatedAt ? (typeof data.updatedAt.toDate === 'function' ? data.updatedAt.toDate().toISOString() : String(data.updatedAt)) : new Date().toISOString(),
      }];
    }
    return [];
  } catch (err) {
    console.error('[FCM] Gagal ambil user devices:', err);
    return [];
  }
}

// ─── Full registration flow ──────────────────────────────────────

/**
 * Registrasi FCM lengkap setelah login.
 * - Cek platform support
 * - Minta permission (iOS perlu PWA)
 * - Dapatkan token
 * - Simpan ke Firestore
 */
export async function registerFCM(userId: string): Promise<string | null> {
  const { supportsPush, isIOS, iOSPushSupported, isInstalledPWA } = getPlatformInfo();

  // Cek dukungan dasar
  if (!supportsPush) {
    console.info('[FCM] Push notification tidak didukung di browser/platform ini');
    return null;
  }

  // iOS: memerlukan versi 16.4+ DAN harus diinstall sebagai PWA
  if (isIOS) {
    if (!isInstalledPWA) {
      console.info('[FCM] iOS push hanya berfungsi jika app diinstall (Add to Home Screen)');
      return null; // Tidak akan berhasil tanpa PWA — jangan coba getToken
    }
    if (!iOSPushSupported) {
      console.info('[FCM] iOS versi terlalu lama untuk push (butuh iOS 16.4+)');
      return null;
    }
  }

  try {
    if (!isInitialized) initializeFCM();
    if (!messaging)     return null;

    const token = await getFCMToken();
    if (!token) return null;

    await saveFCMTokenToFirestore(userId, token);
    console.log('[FCM] Registrasi berhasil untuk userId:', userId);
    return token;
  } catch (err) {
    console.warn('[FCM] registerFCM gagal (non-fatal):', err);
    return null;
  }
}

// ─── Foreground listener ─────────────────────────────────────────

/**
 * Setup listener pesan FCM saat app di-foreground.
 * Idempoten — aman dipanggil berkali-kali.
 */
export function setupForegroundMessageListener(callback: (payload: any) => void): void {
  if (!messaging || foregroundListenerSet) return;

  try {
    onMessage(messaging, (payload) => {
      callback(payload);

      // Tampilkan notifikasi manual (browser foreground tidak otomatis)
      if (Notification.permission === 'granted') {
        const notifObj = payload.notification || {};
        const dataObj  = payload.data || {};
        const title    = notifObj.title || dataObj.title || '⏰ Jadhuman Notifikasi';
        const body     = notifObj.body  || dataObj.body  || 'Anda memiliki pesan pengingat baru.';
        const tag      = dataObj.tag || (notifObj as any).tag || 'jadhuman-foreground';

        const options: any = {
          body,
          icon:               '/assets/jadhuman.svg',
          badge:              '/assets/jadhuman-monochrome-badge.svg',
          tag,
          data:               dataObj,
          vibrate:            [300, 100, 300, 100, 300],
          requireInteraction: true,
        };

        // Gunakan ServiceWorkerRegistration.showNotification (WAJIB di Android Chrome & PWA)
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then((reg) => {
            reg.showNotification(title, options);
          }).catch(() => {
            try { new Notification(title, options); } catch { /* ignore */ }
          });
        } else {
          try { new Notification(title, options); } catch { /* ignore */ }
        }
      }
    });

    foregroundListenerSet = true;
  } catch (err) {
    console.warn('[FCM] Setup foreground listener gagal:', err);
  }
}

// ─── Support check ───────────────────────────────────────────────

/**
 * Cek apakah FCM push notification didukung di device ini.
 * Gunakan sebelum menampilkan UI terkait notifikasi.
 */
export function isFCMSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Kembalikan string status notifikasi yang human-readable
 */
export function getFCMStatusMessage(): string {
  const { isIOS, iOSPushSupported, isInstalledPWA, supportsPush, iosSafariVersion } = getPlatformInfo();

  if (!supportsPush) {
    // iOS yang belum install PWA: Notification tidak ada → supportsPush false
    if (isIOS && !isInstalledPWA) return 'Tambahkan ke Home Screen (iOS) untuk aktifkan notifikasi.';
    if (isIOS && iosSafariVersion < 16) return 'iOS 16.4+ diperlukan untuk notifikasi.';
    return 'Push notification tidak didukung di browser ini.';
  }
  if (isIOS && !isInstalledPWA) return 'Tambahkan ke Home Screen (iOS) untuk aktifkan notifikasi.';
  if (isIOS && !iOSPushSupported) return 'iOS 16.4+ diperlukan untuk notifikasi.';
  if (Notification.permission === 'denied') return 'Izin notifikasi ditolak. Aktifkan di pengaturan browser.';
  if (Notification.permission === 'granted') return 'Notifikasi aktif.';
  return 'Izin notifikasi belum diberikan.';
}
