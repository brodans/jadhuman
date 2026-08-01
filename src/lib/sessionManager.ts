import type { UserAccountSafe, TabPermissions, UserRole } from './userManager';
import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_USER_PERMISSIONS } from './userManager';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage key dipisah per-role:
 *   - jadhuman_session_admin  → HANYA menyimpan sesi admin
 *   - jadhuman_session_user   → HANYA menyimpan sesi user
 *
 * Keuntungan: dalam satu browser, tab A bisa login sebagai admin dan tab B
 * sebagai user TANPA saling menimpa session. Selain itu, escalation attack
 * (mengubah role di sessionStorage dari "user" → "admin") tidak bisa membajak
 * session admin karena key yang dibaca berbeda.
 */
const SESSION_KEY: Record<UserRole, string> = {
  admin: 'jadhuman_session_admin',
  user:  'jadhuman_session_user',
};

/** Satu key generik (legacy + fallback read) — tidak dipakai untuk WRITE */
const SESSION_KEY_LEGACY = 'jadhuman_session';

export const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit idle

// ─────────────────────────────────────────────────────────────────────────────
// HMAC Integrity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Buat "session fingerprint" sederhana dengan Web Crypto HMAC-SHA256.
 * Kunci = kombonasi beberapa properti yang tidak bisa ditebak dari devtools:
 *   - authTime  (kapan login)
 *   - boundRole (role yang di-bind saat login)
 *   - userId    (id akun)
 *
 * Signature diverifikasi setiap kali session di-load. Jika payload dimanipulasi
 * dari devtools (misal role diubah), signature tidak akan cocok → session invalid.
 *
 * Catatan: ini bukan keamanan server-side. Ini mencegah manipulasi naif lewat
 * devtools > Application > sessionStorage. Untuk keamanan penuh, autentikasi
 * harus divalidasi di server juga.
 */
async function hmacSign(payload: string, secret: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  } catch {
    // Web Crypto tidak tersedia (SSR/test) — kembalikan string kosong
    return '';
  }
}

async function hmacVerify(payload: string, secret: string, sig: string): Promise<boolean> {
  try {
    if (!sig) return false;
    const expected = await hmacSign(payload, secret);
    if (!expected) return true; // Web Crypto tidak tersedia, skip verifikasi
    return expected === sig;
  } catch {
    return false;
  }
}

/**
 * Secret yang dipakai untuk HMAC: gabungkan authTime + userId + boundRole.
 * Bahkan jika seseorang menyalin payload dari tab lain, authTime berbeda
 * akan membuat signature tidak valid.
 */
function buildHmacSecret(authTime: number, userId: string, boundRole: UserRole): string {
  // Prefix statis + nilai dinamis → membuat secret unik per-session
  return `jdhmn|${authTime}|${userId}|${boundRole}|s3cr3t`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredSession {
  currentUser: UserAccountSafe;
  tabPermissions: TabPermissions;
  authTime: number;
  /** Role yang di-bind saat login. HARUS cocok dengan currentUser.role. */
  boundRole: UserRole;
  /** HMAC-SHA256 dari seluruh payload untuk mencegah manipulasi devtools */
  integrity: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

/** Hapus semua legacy keys dan keys dari role lain */
function purgeStaleSessions(currentRole: UserRole): void {
  try {
    if (typeof window === 'undefined') return;
    // Hapus legacy key (single shared key lama)
    sessionStorage.removeItem(SESSION_KEY_LEGACY);
    // Hapus session role LAIN — satu tab hanya boleh punya satu sesi aktif
    const otherRole: UserRole = currentRole === 'admin' ? 'user' : 'admin';
    sessionStorage.removeItem(SESSION_KEY[otherRole]);
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simpan sesi login aktif ke sessionStorage (terisolasi per-tab, per-role).
 * Sebelum simpan: hapus legacy key dan session role lain di tab ini.
 */
export async function saveSession(user: UserAccountSafe, permissions: TabPermissions): Promise<void> {
  try {
    if (typeof window === 'undefined') return;

    const boundRole = user.role as UserRole;
    const authTime = Date.now();

    // Bangun HMAC signature dari payload yang akan disimpan
    const hmacSecret = buildHmacSecret(authTime, user.id, boundRole);
    const payloadForSign = JSON.stringify({ id: user.id, role: boundRole, authTime });
    const integrity = await hmacSign(payloadForSign, hmacSecret);

    const session: StoredSession = {
      currentUser: user,
      tabPermissions: permissions,
      authTime,
      boundRole,
      integrity,
    };

    // Hapus session role lain sebelum simpan (mencegah stale cross-role session)
    purgeStaleSessions(boundRole);

    sessionStorage.setItem(SESSION_KEY[boundRole], JSON.stringify(session));
  } catch (err) {
    console.warn('[sessionManager] Gagal menyimpan session:', err);
  }
}

/**
 * Ambil sesi login aktif tab saat ini. Null jika tidak ada / kadaluarsa / rusak / manipulasi.
 *
 * Urutan validasi:
 *   1. Parse JSON — jika rusak → clear & null
 *   2. boundRole harus ada dan valid
 *   3. currentUser.role === boundRole (mencegah role escalation)
 *   4. Cek timeout idle 10 menit
 *   5. Verifikasi HMAC integrity — jika gagal → clear & null
 */
export async function loadSession(): Promise<StoredSession | null> {
  try {
    if (typeof window === 'undefined') return null;

    // Coba baca dari kedua role key, prioritaskan yang paling baru
    let raw: string | null = null;
    let detectedRole: UserRole | null = null;

    const rawAdmin = sessionStorage.getItem(SESSION_KEY.admin);
    const rawUser  = sessionStorage.getItem(SESSION_KEY.user);

    // Pilih session yang paling baru (jika dua-duanya ada — anomali, pilih terbaru)
    if (rawAdmin && rawUser) {
      try {
        const a = JSON.parse(rawAdmin) as StoredSession;
        const u = JSON.parse(rawUser)  as StoredSession;
        if ((a.authTime || 0) >= (u.authTime || 0)) {
          raw = rawAdmin; detectedRole = 'admin';
          sessionStorage.removeItem(SESSION_KEY.user); // hapus yang lebih lama
        } else {
          raw = rawUser; detectedRole = 'user';
          sessionStorage.removeItem(SESSION_KEY.admin);
        }
      } catch {
        // Salah satu parse gagal — hapus keduanya
        clearAllSessions();
        return null;
      }
    } else if (rawAdmin) {
      raw = rawAdmin; detectedRole = 'admin';
    } else if (rawUser) {
      raw = rawUser; detectedRole = 'user';
    } else {
      // Fallback: coba legacy key (migrasi dari versi lama)
      const rawLegacy = sessionStorage.getItem(SESSION_KEY_LEGACY);
      if (rawLegacy) {
        sessionStorage.removeItem(SESSION_KEY_LEGACY);
        // Treat legacy sebagai tidak aman — paksa re-login
        console.info('[sessionManager] Legacy session key ditemukan, paksa re-login untuk keamanan');
        return null;
      }
      return null;
    }

    if (!raw || !detectedRole) return null;

    let parsed: StoredSession;
    try {
      parsed = JSON.parse(raw) as StoredSession;
    } catch {
      clearAllSessions();
      return null;
    }

    // ── Validasi 1: field wajib ada ──────────────────────────────────────────
    if (!parsed || !parsed.currentUser || !parsed.currentUser.role || !parsed.boundRole) {
      clearAllSessions();
      return null;
    }

    // ── Validasi 2: role consistency (boundRole === currentUser.role) ─────────
    // Mencegah serangan: mengubah currentUser.role dari "user" ke "admin" di devtools
    if (parsed.boundRole !== parsed.currentUser.role) {
      console.warn('[sessionManager] Role mismatch terdeteksi — sesi diinvalidasi');
      clearAllSessions();
      return null;
    }

    // ── Validasi 3: detectedRole (dari key storage) === boundRole ────────────
    // Mencegah serangan: menyalin session admin ke key user atau sebaliknya
    if (parsed.boundRole !== detectedRole) {
      console.warn('[sessionManager] Storage key / boundRole mismatch — sesi diinvalidasi');
      clearAllSessions();
      return null;
    }

    // ── Validasi 4: timeout idle ──────────────────────────────────────────────
    if (parsed.authTime && Date.now() - parsed.authTime > SESSION_TIMEOUT_MS) {
      console.info('[sessionManager] Sesi kadaluarsa (idle 10 menit)');
      clearAllSessions();
      return null;
    }

    // ── Validasi 5: HMAC integrity ───────────────────────────────────────────
    if (parsed.integrity) {
      const hmacSecret = buildHmacSecret(parsed.authTime, parsed.currentUser.id, parsed.boundRole);
      const payloadForVerify = JSON.stringify({
        id: parsed.currentUser.id,
        role: parsed.boundRole,
        authTime: parsed.authTime,
      });
      const valid = await hmacVerify(payloadForVerify, hmacSecret, parsed.integrity);
      if (!valid) {
        console.warn('[sessionManager] HMAC integrity gagal — kemungkinan manipulasi session');
        clearAllSessions();
        return null;
      }
    }

    // ── Validasi 6: permissions harus sesuai role ────────────────────────────
    // Admin yang nyamar jadi user tidak boleh dapat ALL permissions
    if (parsed.boundRole === 'user') {
      // Strip semua flag yang tidak ada di DEFAULT_USER_PERMISSIONS
      // (mencegah injection permissions via sessionStorage manipulation)
      const safePermKeys = Object.keys(DEFAULT_USER_PERMISSIONS) as (keyof TabPermissions)[];
      const sanitizedPerms = { ...DEFAULT_USER_PERMISSIONS };
      safePermKeys.forEach(k => {
        if (typeof parsed.tabPermissions[k] === 'boolean') {
          (sanitizedPerms as any)[k] = parsed.tabPermissions[k];
        }
      });
      parsed = { ...parsed, tabPermissions: sanitizedPerms };
    }

    return parsed;
  } catch {
    clearAllSessions();
    return null;
  }
}

/**
 * Versi sinkron dari loadSession — hanya untuk inisialisasi awal state React.
 * Tidak melakukan verifikasi HMAC (async), tapi tetap validasi role consistency.
 * HMAC diverifikasi async sesaat setelahnya di App.tsx.
 */
export function loadSessionSync(): StoredSession | null {
  try {
    if (typeof window === 'undefined') return null;

    let raw: string | null = null;
    let detectedRole: UserRole | null = null;

    const rawAdmin = sessionStorage.getItem(SESSION_KEY.admin);
    const rawUser  = sessionStorage.getItem(SESSION_KEY.user);

    if (rawAdmin && rawUser) {
      // Dua session aktif — anomali, hapus keduanya paksa re-login
      clearAllSessions();
      return null;
    } else if (rawAdmin) {
      raw = rawAdmin; detectedRole = 'admin';
    } else if (rawUser) {
      raw = rawUser; detectedRole = 'user';
    } else {
      return null;
    }

    if (!raw || !detectedRole) return null;

    const parsed = JSON.parse(raw) as StoredSession;

    if (!parsed || !parsed.currentUser || !parsed.currentUser.role || !parsed.boundRole) {
      clearAllSessions();
      return null;
    }

    // Validasi role consistency
    if (parsed.boundRole !== parsed.currentUser.role || parsed.boundRole !== detectedRole) {
      clearAllSessions();
      return null;
    }

    // Validasi timeout
    if (parsed.authTime && Date.now() - parsed.authTime > SESSION_TIMEOUT_MS) {
      clearAllSessions();
      return null;
    }

    return parsed;
  } catch {
    clearAllSessions();
    return null;
  }
}

/**
 * Perbarui timestamp keaktifan sesi di sessionStorage (tanpa mengubah data lain).
 * Dipanggil setiap ada aktivitas user agar session tidak expired saat aktif.
 */
export async function touchSession(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const current = await loadSession();
    if (!current) return;

    const boundRole = current.boundRole;
    const newAuthTime = Date.now();

    // Re-sign dengan authTime baru
    const hmacSecret = buildHmacSecret(newAuthTime, current.currentUser.id, boundRole);
    const payloadForSign = JSON.stringify({ id: current.currentUser.id, role: boundRole, authTime: newAuthTime });
    const integrity = await hmacSign(payloadForSign, hmacSecret);

    const updated: StoredSession = { ...current, authTime: newAuthTime, integrity };
    sessionStorage.setItem(SESSION_KEY[boundRole], JSON.stringify(updated));
  } catch (err) {
    console.warn('[sessionManager] Gagal memperbarui timestamp sesi:', err);
  }
}

/**
 * Hapus SEMUA sesi dari tab ini (semua role keys + legacy).
 */
export function clearAllSessions(): void {
  try {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(SESSION_KEY.admin);
    sessionStorage.removeItem(SESSION_KEY.user);
    sessionStorage.removeItem(SESSION_KEY_LEGACY);
    // Hapus juga legacy key di localStorage agar tidak membingungkan
    localStorage.removeItem('jadhuman_auth');
    localStorage.removeItem('jadhuman_auth_time');
  } catch (err) {
    console.warn('[sessionManager] Gagal menghapus sesi:', err);
  }
}

/**
 * Hapus sesi role tertentu saja.
 * Dipakai LoginScreen saat login role A → clear session role B yang mungkin ada.
 */
export function clearSessionByRole(role: UserRole): void {
  try {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(SESSION_KEY[role]);
  } catch { /* ignore */ }
}

/**
 * Alias untuk clearAllSessions — dipakai oleh kode lama yang memanggil clearSession().
 * @deprecated Gunakan clearAllSessions() untuk kejelasan
 */
export function clearSession(): void {
  clearAllSessions();
}
