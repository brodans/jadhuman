// ============================================================
//  src/lib/subscription.ts
//  Helper untuk sistem subscription/payment per akun di jadhuman.
//  Koleksi Firestore: 'jadhuman_subscriptions'
//  Doc ID: userId
// ============================================================

import { db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BillingType = 'monthly' | 'one_time';
export type SubscriptionStatus = 'active' | 'expired' | 'unpaid';

export interface UserSubscription {
  user_id:              string;
  billing_type:         BillingType;
  amount:               number;        // dalam Rupiah, default 50000
  payment_enabled:      boolean;       // false = admin bypass, tidak perlu bayar
  status:               SubscriptionStatus;
  paid_at:              Timestamp | null;
  expires_at:           Timestamp | null; // null jika one_time dan sudah bayar
  midtrans_order_id:    string | null;
  midtrans_snap_token:  string | null;
  created_at?:          Timestamp;
  updated_at?:          Timestamp;
}

export const DEFAULT_SUBSCRIPTION: Omit<UserSubscription, 'user_id'> = {
  billing_type:        'monthly',
  amount:              50000,
  payment_enabled:     true,
  status:              'unpaid',
  paid_at:             null,
  expires_at:          null,
  midtrans_order_id:   null,
  midtrans_snap_token: null,
};

const COLLECTION = 'jadhuman_subscriptions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatRp(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Baca subscription user dari Firestore.
 * Jika belum ada dokumen, return null.
 */
export async function getSubscription(userId: string): Promise<UserSubscription | null> {
  if (!userId) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, userId));
    if (!snap.exists()) return null;
    return { user_id: userId, ...snap.data() } as UserSubscription;
  } catch (err) {
    console.error('[subscription] getSubscription error:', err);
    return null;
  }
}

/**
 * Cek apakah subscription aktif.
 * Logika:
 *  - payment_enabled === false → selalu bypass (aktif)
 *  - status === 'active' DAN (one_time ATAU expires_at belum lewat) → aktif
 *  - selain itu → tidak aktif
 */
export function isSubscriptionActive(sub: UserSubscription | null): boolean {
  if (!sub) return false;
  if (sub.payment_enabled === false) return true;
  if (sub.status !== 'active') return false;
  if (sub.billing_type === 'one_time') return true;
  if (!sub.expires_at) return true;
  const raw = sub.expires_at as any;
  const expiresMs = sub.expires_at instanceof Timestamp
    ? sub.expires_at.toMillis()
    : (raw?.seconds != null ? raw.seconds * 1000 : 0);
  return Date.now() < expiresMs;
}

/**
 * Jika monthly dan expires_at sudah lewat, otomatis update status ke 'expired'.
 * Return sub yang sudah diupdate.
 */
export async function checkAndAutoExpire(sub: UserSubscription): Promise<UserSubscription> {
  if (sub.payment_enabled === false) return sub;
  if (sub.status !== 'active') return sub;
  if (sub.billing_type !== 'monthly' || !sub.expires_at) return sub;

  const raw2 = sub.expires_at as any;
  const expiresMs = sub.expires_at instanceof Timestamp
    ? sub.expires_at.toMillis()
    : (raw2?.seconds != null ? raw2.seconds * 1000 : 0);

  if (Date.now() >= expiresMs) {
    const updated: Partial<UserSubscription> = {
      status: 'expired',
      updated_at: serverTimestamp() as unknown as Timestamp,
    };
    try {
      await setDoc(doc(db, COLLECTION, sub.user_id), updated, { merge: true });
    } catch (err) {
      console.warn('[subscription] checkAndAutoExpire write error:', err);
    }
    return { ...sub, status: 'expired' };
  }

  return sub;
}

/**
 * Buat atau update subscription user di Firestore.
 * Admin bisa pakai ini untuk atur besaran biaya, tipe billing, toggle payment.
 */
export async function createOrUpdateSubscription(
  userId: string,
  data: Partial<Omit<UserSubscription, 'user_id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  if (!userId) return;
  try {
    const snap = await getDoc(doc(db, COLLECTION, userId));
    const payload: any = {
      user_id:  userId,
      ...data,
      updated_at: serverTimestamp(),
    };
    if (!snap.exists()) {
      payload.created_at = serverTimestamp();
      // Set defaults untuk field yang tidak disuplai
      const defaults = { ...DEFAULT_SUBSCRIPTION };
      for (const [k, v] of Object.entries(defaults)) {
        if (!(k in payload)) payload[k] = v;
      }
    }
    await setDoc(doc(db, COLLECTION, userId), payload, { merge: true });
  } catch (err) {
    console.error('[subscription] createOrUpdateSubscription error:', err);
    throw err;
  }
}

/**
 * Aktifkan subscription secara manual (misal pembayaran tunai/transfer langsung ke admin).
 */
export async function manualActivateSubscription(
  userId: string,
  billingType: BillingType = 'monthly',
  durationDays = 30
): Promise<void> {
  if (!userId) return;
  const now = new Date();
  const expiresAt = billingType === 'monthly'
    ? Timestamp.fromDate(new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000))
    : null;

  await createOrUpdateSubscription(userId, {
    status: 'active',
    billing_type: billingType,
    paid_at: Timestamp.fromDate(now),
    expires_at: expiresAt,
  });
}

/**
 * Ambil semua data subscription dari Firestore untuk dashboard admin.
 */
export async function getAllSubscriptions(): Promise<Record<string, UserSubscription>> {
  try {
    const { collection, getDocs } = await import('firebase/firestore');
    const querySnapshot = await getDocs(collection(db, COLLECTION));
    const result: Record<string, UserSubscription> = {};
    querySnapshot.forEach(docSnap => {
      result[docSnap.id] = { user_id: docSnap.id, ...docSnap.data() } as UserSubscription;
    });
    return result;
  } catch (err) {
    console.error('[subscription] getAllSubscriptions error:', err);
    return {};
  }
}

