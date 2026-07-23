import type { UserAccountSafe, TabPermissions } from './userManager';
import { DEFAULT_ADMIN_PERMISSIONS } from './userManager';

const SESSION_STORAGE_KEY = 'jadhuman_session';
export const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit

export interface StoredSession {
  currentUser: UserAccountSafe;
  tabPermissions: TabPermissions;
  authTime: number;
}

/**
 * Buat object user aman untuk Admin
 */
export function createAdminUserAccount(username = 'admin'): UserAccountSafe {
  return {
    id: 'admin',
    username: username.toLowerCase().trim() || 'admin',
    displayName: 'Administrator',
    role: 'admin',
    permissions: DEFAULT_ADMIN_PERMISSIONS,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Simpan sesi login aktif tab saat ini ke sessionStorage (terisolasi per-tab)
 */
export function saveSession(user: UserAccountSafe, permissions: TabPermissions): void {
  try {
    if (typeof window === 'undefined') return;
    const session: StoredSession = {
      currentUser: user,
      tabPermissions: permissions,
      authTime: Date.now(),
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn('[sessionManager] Gagal menyimpan session:', err);
  }
}

/**
 * Ambil sesi login aktif tab saat ini. Null jika tidak ada / kadaluarsa / rusak.
 */
export function loadSession(): StoredSession | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed || !parsed.currentUser || !parsed.currentUser.role) {
      clearSession();
      return null;
    }

    // Cek batas idle 10 menit
    if (parsed.authTime && Date.now() - parsed.authTime > SESSION_TIMEOUT_MS) {
      console.log('[sessionManager] Sesi telah kadaluarsa (idle 10 menit)');
      clearSession();
      return null;
    }

    return parsed;
  } catch {
    clearSession();
    return null;
  }
}

/**
 * Perbarui timestamp keaktifan sesi di sessionStorage
 */
export function touchSession(): void {
  try {
    if (typeof window === 'undefined') return;
    const current = loadSession();
    if (current) {
      current.authTime = Date.now();
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(current));
    }
  } catch (err) {
    console.warn('[sessionManager] Gagal memperbarui timestamp sesi:', err);
  }
}

/**
 * Hapus sesi login tab saat ini
 */
export function clearSession(): void {
  try {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    // Hapus juga legacy key di localStorage agar tidak membingungkan
    localStorage.removeItem('jadhuman_auth');
    localStorage.removeItem('jadhuman_auth_time');
  } catch (err) {
    console.warn('[sessionManager] Gagal menghapus sesi:', err);
  }
}
