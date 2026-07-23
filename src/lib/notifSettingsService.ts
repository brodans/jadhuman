// ============================================================
//  src/lib/notifSettingsService.ts
//  Service untuk menyimpan & membaca Pengaturan Notifikasi per User di Firebase Firestore
//  Collection: 'jadhuman_notif_settings'
//  Doc ID: userId
// ============================================================

import { db } from './firebase';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { PresensiScheduleConfig, getDefaultPresensiConfig } from './qstashService';

export interface UserNotificationSettings {
  notifEnabled: boolean;
  presensiConfig: PresensiScheduleConfig;
  updatedAt?: any;
}

const NOTIF_SETTINGS_COLLECTION = 'jadhuman_notif_settings';
const notifPrefKey = (userId: string) => `jadhuman_notif_enabled_${userId}`;
const presensiConfigKey = (userId: string) => `jadhuman_presensi_config_${userId}`;

export const DEFAULT_NOTIF_SETTINGS: UserNotificationSettings = {
  notifEnabled: true,
  presensiConfig: getDefaultPresensiConfig(),
};

/**
 * Membaca settings notifikasi user dari Firestore (dengan fallback ke localStorage / default)
 */
export async function getUserNotifSettings(userId: string): Promise<UserNotificationSettings> {
  if (!userId) return DEFAULT_NOTIF_SETTINGS;

  try {
    const docRef = doc(db, NOTIF_SETTINGS_COLLECTION, userId);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      const settings: UserNotificationSettings = {
        notifEnabled: typeof data.notifEnabled === 'boolean' ? data.notifEnabled : true,
        presensiConfig: {
          ...getDefaultPresensiConfig(),
          ...(data.presensiConfig || {}),
        },
      };

      // Sync local cache
      try {
        localStorage.setItem(notifPrefKey(userId), settings.notifEnabled ? 'true' : 'false');
        localStorage.setItem(presensiConfigKey(userId), JSON.stringify(settings.presensiConfig));
      } catch { /* ignore localstorage error */ }

      return settings;
    }
  } catch (err) {
    console.warn(`[notifSettingsService] Gagal membaca settings Firestore untuk ${userId}:`, err);
  }

  // Fallback to localStorage if Firestore read fails or doc doesn't exist yet
  return getLocalNotifSettings(userId);
}

/**
 * Membaca settings dari localStorage (fallback lokal)
 */
export function getLocalNotifSettings(userId: string): UserNotificationSettings {
  let notifEnabled = true;
  let presensiConfig = getDefaultPresensiConfig();

  try {
    const prefRaw = localStorage.getItem(notifPrefKey(userId));
    if (prefRaw !== null) notifEnabled = prefRaw === 'true';

    const pRaw = localStorage.getItem(presensiConfigKey(userId));
    if (pRaw) presensiConfig = { ...getDefaultPresensiConfig(), ...JSON.parse(pRaw) };
  } catch { /* ignore */ }

  return { notifEnabled, presensiConfig };
}

/**
 * Menyimpan settings notifikasi user ke Firebase Firestore
 */
export async function saveUserNotifSettings(
  userId: string,
  settings: Partial<UserNotificationSettings>
): Promise<void> {
  if (!userId) return;

  // Update local cache immediately
  try {
    if (typeof settings.notifEnabled === 'boolean') {
      localStorage.setItem(notifPrefKey(userId), settings.notifEnabled ? 'true' : 'false');
    }
    if (settings.presensiConfig) {
      localStorage.setItem(presensiConfigKey(userId), JSON.stringify(settings.presensiConfig));
    }
  } catch { /* ignore */ }

  // Save to Firebase Firestore
  try {
    const docRef = doc(db, NOTIF_SETTINGS_COLLECTION, userId);
    const payload: Record<string, any> = {
      userId,
      updatedAt: serverTimestamp(),
    };

    if (typeof settings.notifEnabled === 'boolean') {
      payload.notifEnabled = settings.notifEnabled;
    }
    if (settings.presensiConfig) {
      payload.presensiConfig = settings.presensiConfig;
    }

    await setDoc(docRef, payload, { merge: true });
    console.log(`[notifSettingsService] Berhasil menyimpan settings notifikasi Firebase untuk user: ${userId}`);
  } catch (err) {
    console.error(`[notifSettingsService] Gagal menyimpan settings notifikasi Firebase untuk ${userId}:`, err);
  }
}

/**
 * Subscribe real-time perubahan settings notifikasi di Firebase Firestore
 */
export function subscribeUserNotifSettings(
  userId: string,
  onUpdate: (settings: UserNotificationSettings) => void
): () => void {
  if (!userId) return () => {};

  const docRef = doc(db, NOTIF_SETTINGS_COLLECTION, userId);
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const settings: UserNotificationSettings = {
          notifEnabled: typeof data.notifEnabled === 'boolean' ? data.notifEnabled : true,
          presensiConfig: {
            ...getDefaultPresensiConfig(),
            ...(data.presensiConfig || {}),
          },
        };

        // Update local cache
        try {
          localStorage.setItem(notifPrefKey(userId), settings.notifEnabled ? 'true' : 'false');
          localStorage.setItem(presensiConfigKey(userId), JSON.stringify(settings.presensiConfig));
        } catch { /* ignore */ }

        onUpdate(settings);
      }
    },
    (err) => {
      console.warn(`[notifSettingsService] Error snapshot listeners untuk ${userId}:`, err);
    }
  );
}
