// ============================================================
//  src/lib/notifSettingsService.ts
//  Service untuk menyimpan & membaca Pengaturan Notifikasi per User di Firebase Firestore
//  Collection: 'jadhuman_notif_settings'
//  Doc ID: userId
// ============================================================

import { db } from './firebase';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

export interface UserNotificationSettings {
  notifEnabled: boolean;
  updatedAt?: any;
}

const NOTIF_SETTINGS_COLLECTION = 'jadhuman_notif_settings';
const notifPrefKey = (userId: string) => `jadhuman_notif_enabled_${userId}`;

/**
 * Membaca settings dari localStorage (fallback lokal)
 */
export function getLocalNotifSettings(userId: string): UserNotificationSettings {
  let notifEnabled = true;

  try {
    const prefRaw = localStorage.getItem(notifPrefKey(userId));
    if (prefRaw !== null) notifEnabled = prefRaw === 'true';
  } catch { /* ignore */ }

  return { notifEnabled };
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
        };

        // Update local cache
        try {
          localStorage.setItem(notifPrefKey(userId), settings.notifEnabled ? 'true' : 'false');
        } catch { /* ignore */ }

        onUpdate(settings);
      }
    },
    (err) => {
      console.warn(`[notifSettingsService] Error snapshot listeners untuk ${userId}:`, err);
    }
  );
}
