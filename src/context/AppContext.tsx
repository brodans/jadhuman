import React, { createContext, useContext, useState, ReactNode } from 'react';
import { getTodayWIB } from '../lib/dateFormatter';
import type { UserRole, TabPermissions, UserAccountSafe } from '../lib/userManager';
import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_USER_PERMISSIONS } from '../lib/userManager';
import { clearServerLoginCache } from '../lib/cacheManager';
import {
  loadSession,
  loadSessionSync,
  saveSession,
  clearAllSessions,
} from '../lib/sessionManager';

export interface InstansiLogState {
  dateStart: string;
  dateEnd: string;
  unorCode: string;
  selectedOPD: any | null;
  searchOPD: string;
  searchQuery: string;
  currentPage: number;
  pageSize: number;
  logs: any[];
  totalElements: number;
  totalPages: number;
  hasLoadedOnce: boolean;
}

interface PegawaiData {
  id?: string;
  nama?: string;
  nip?: string;
  nama_jabatan?: string;
  kelas_jabatan?: string;
  nama_instansi?: string;
  nama_lokasi?: string;
  foto?: string;
  password?: string;
  kode_unor?: string;
  alamat_kantor?: string;
  alamat?: string;
  unor?: string;
  nama_unit_kerja?: string;
  message?: string;
}

interface KredensialConfig {
  idPegawai: string;
  deviceId: string;
  latitude: string;
  longitude: string;
  idLokasi: string;
  kodeInstansi: string;
  kodeUnor: string;
  workMode: string;
  versi: string;
}

interface AppContextType {
  pegawai: PegawaiData | null;
  setPegawai: (data: PegawaiData | null | ((prev: PegawaiData | null) => PegawaiData | null)) => void;
  config: KredensialConfig;
  setConfig: React.Dispatch<React.SetStateAction<KredensialConfig>>;
  loginForm: { username: string, password: string };
  setLoginForm: React.Dispatch<React.SetStateAction<{ username: string, password: string }>>;
  developerMode: boolean;
  setDeveloperMode: (val: boolean) => void;
  datePickerStyle: 'modern' | 'klasik';
  setDatePickerStyle: (val: 'modern' | 'klasik') => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  instansiLogState: InstansiLogState;
  setInstansiLogState: React.Dispatch<React.SetStateAction<InstansiLogState>>;
  // Auth user system
  currentUser: UserAccountSafe | null;
  setCurrentUser: (user: UserAccountSafe | null) => void;
  userRole: UserRole;
  tabPermissions: TabPermissions;
  setTabPermissions: (perms: TabPermissions) => void;
  // Trigger auto-login ke server pusat setelah login akun Jadhuman
  autoLoginTrigger: number;
  // Flag: apakah session sudah diverifikasi HMAC (async) — hindari render sensitif sebelum ini
  sessionVerified: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// ─── Blank / safe default permissions (unauthenticated state) ───────────────
// PENTING: default BUKAN DEFAULT_ADMIN_PERMISSIONS.
// Jika currentUser null (belum login), tidak ada hak akses apapun.
const UNAUTHENTICATED_PERMISSIONS: TabPermissions = {
  ...DEFAULT_USER_PERMISSIONS,
  tabLogin:  false,
  tabAbsen:  false,
  tabNotifikasi: false,
};

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Inisialisasi SINKRON dari sessionStorage (cepat, tanpa await) ─────────
  // Verifikasi HMAC penuh dilakukan async sesaat setelah mount (lihat useEffect di bawah).
  // Ini mencegah flicker / blank screen sambil tetap aman.
  const initialSession = loadSessionSync();

  const [currentUser, setCurrentUserState] = useState<UserAccountSafe | null>(() => {
    return initialSession ? initialSession.currentUser : null;
  });
  const currentUserRef = React.useRef<UserAccountSafe | null>(currentUser);

  // ⚠️ SECURITY: default tabPermissions HARUS menggunakan UNAUTHENTICATED_PERMISSIONS
  // (semua false) saat currentUser = null, bukan DEFAULT_ADMIN_PERMISSIONS.
  // Jika ada session, restore dari storage — tapi HANYA setelah sessionVerified = true.
  const [tabPermissions, setTabPermissionsState] = useState<TabPermissions>(() => {
    if (!initialSession) return UNAUTHENTICATED_PERMISSIONS;
    return initialSession.tabPermissions;
  });

  // Flag: apakah session sudah melewati verifikasi HMAC penuh (async)
  // Sebelum verified, komponen sensitif sebaiknya tidak dirender
  const [sessionVerified, setSessionVerified] = useState<boolean>(false);

  /**
   * autoLoginTrigger: Counter yang di-increment setiap login Jadhuman berhasil.
   * TabLogin & MainApp watch ini untuk trigger auto-login ke server pusat.
   *
   * PENTING: Dimulai dari 0 agar TIDAK trigger runAutoLogin saat refresh/restore session.
   * runAutoLogin hanya boleh jalan saat nilai ini berubah (increment via setCurrentUser).
   * lastHandledAutoLogin ref di MainApp dimulai dari 0 (sama), sehingga kondisi
   * `lastHandledAutoLogin.current === autoLoginTrigger` → TRUE → skip saat pertama mount.
   */
  const [autoLoginTrigger, setAutoLoginTrigger] = useState(0);

  // ⚠️ SECURITY: jika currentUser null (unauthenticated), userRole HARUS 'user'
  const userRole: UserRole = currentUser?.role ?? 'user';

  // Simpan referensi sinkron ke currentUser (dipakai saat ganti akun)
  React.useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // ── Verifikasi HMAC async setelah mount ──────────────────────────────────
  // loadSession() (async) melakukan 6 lapis validasi termasuk HMAC.
  // Jika gagal → paksa logout / invalidasi session.
  React.useEffect(() => {
    let cancelled = false;

    const verifySessionIntegrity = async () => {
      // Jika tidak ada sesi sinkron, tidak perlu verifikasi
      if (!initialSession) {
        if (!cancelled) setSessionVerified(true);
        return;
      }

      try {
        const verified = await loadSession();
        if (cancelled) return;

        if (!verified) {
          // Session tidak lulus verifikasi HMAC atau validasi lain → reset state
          console.warn('[AppContext] Session gagal verifikasi integrity — paksa re-login');
          clearAllSessions();
          setCurrentUserState(null);
          setTabPermissionsState(UNAUTHENTICATED_PERMISSIONS);
          // App.tsx akan mendeteksi ini via checkSession() dan redirect ke login
        }
      } catch {
        if (!cancelled) {
          clearAllSessions();
          setCurrentUserState(null);
          setTabPermissionsState(UNAUTHENTICATED_PERMISSIONS);
        }
      } finally {
        if (!cancelled) setSessionVerified(true);
      }
    };

    verifySessionIntegrity();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pegawai, setPegawaiState] = useState<PegawaiData | null>(null);

  const setPegawai = (data: PegawaiData | null | ((prev: PegawaiData | null) => PegawaiData | null)) => {
    setPegawaiState(prev => {
      const next = typeof data === 'function' ? (data as (prev: PegawaiData | null) => PegawaiData | null)(prev) : data;
      return next;
    });
  };

  const [loginForm, setLoginFormState] = useState({ username: '', password: '' });

  const setLoginForm: React.Dispatch<React.SetStateAction<{ username: string, password: string }>> = (value) => {
    setLoginFormState((prev: any) => {
      const next = typeof value === 'function' ? (value as any)(prev) : value;
      return next;
    });
  };

  const [configState, setConfigState] = useState<KredensialConfig>({
    idPegawai: '',
    deviceId: '',
    latitude: '',
    longitude: '',
    idLokasi: '',
    kodeInstansi: '',
    kodeUnor: '',
    workMode: '1',
    versi: '2.0.0'
  });

  const setConfig: React.Dispatch<React.SetStateAction<KredensialConfig>> = (value) => {
    setConfigState((prev: any) => {
      const next = typeof value === 'function' ? (value as any)(prev) : value;
      return next;
    });
  };

  // ── setCurrentUser: dipanggil saat login berhasil atau logout ─────────────
  const setCurrentUser = (user: UserAccountSafe | null) => {
    if (!user) {
      // Logout — bersihkan semua data sensitif dari memory & storage
      clearAllSessions();
      setPegawaiState(null);
      setLoginFormState({ username: '', password: '' });
      setConfigState({
        idPegawai: '', deviceId: '', latitude: '', longitude: '',
        idLokasi: '', kodeInstansi: '', kodeUnor: '', workMode: '1', versi: '2.0.0'
      });
      setCurrentUserState(null);
      // ⚠️ Saat logout, WAJIB reset ke UNAUTHENTICATED (bukan DEFAULT_ADMIN_PERMISSIONS!)
      setTabPermissionsState(UNAUTHENTICATED_PERMISSIONS);
      return;
    }

    // Ganti akun: hapus cache server akun sebelumnya agar tidak bocor ke akun baru
    const prevUsername = currentUserRef.current?.username ?? '';
    const nextUsername = user.username ?? '';
    if (prevUsername && prevUsername !== nextUsername) {
      clearServerLoginCache(prevUsername);
    }

    // Reset data server pusat (akan diisi ulang oleh auto-login dari Firestore)
    setPegawaiState(null);
    setLoginFormState({ username: '', password: '' });
    setConfigState({
      idPegawai: '', deviceId: '', latitude: '', longitude: '',
      idLokasi: '', kodeInstansi: '', kodeUnor: '', workMode: '1', versi: '2.0.0'
    });

    // Tentukan permissions: admin selalu dapat FULL, user dari data Firestore
    const perms: TabPermissions =
      user.role === 'admin'
        ? DEFAULT_ADMIN_PERMISSIONS
        : (user.permissions || DEFAULT_USER_PERMISSIONS);

    setCurrentUserState(user);
    setTabPermissionsState(perms);
    // saveSession sekarang async — fire-and-forget (error diabaikan, UI tidak perlu tunggu)
    saveSession(user, perms).catch(err =>
      console.warn('[AppContext] saveSession error:', err)
    );
    setAutoLoginTrigger(prev => prev + 1);
  };

  const setTabPermissions = (perms: TabPermissions) => {
    setTabPermissionsState(perms);
    if (currentUser) {
      saveSession(currentUser, perms).catch(err =>
        console.warn('[AppContext] saveSession error:', err)
      );
    }
  };

  const PATH_MAP: Record<string, string> = {
    'tabLogin': '/login-info',
    'tabAbsen': '/submit-presensi',
    'tabLog': '/log-presensi',
    'tabInputAktivitas': '/input-aktivitas',
    'tabAktivitas': '/cek-aktivitas',
    'tabIzin': '/cek-izin',
    'tabReview': '/review',
    'tabLogPresensiInstansi': '/log-presensi-instansi',
    'tabDatabase': '/database',
    'tabLokasi': '/data-lokasi',
    'tabReport': '/laporan'
  };

  const getTabFromPath = (path: string): string => {
    for (const [tabId, p] of Object.entries(PATH_MAP)) {
      if (path === p) return tabId;
    }
    return 'tabLogin';
  };

  const [activeTab, setActiveTabState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return getTabFromPath(window.location.pathname);
    }
    return 'tabLogin';
  });

  const setActiveTab = (tabId: string) => {
    setActiveTabState(tabId);
    if (typeof window !== 'undefined') {
      const path = PATH_MAP[tabId] || '/login-info';
      if (window.location.pathname !== path) {
        window.history.pushState(null, '', path);
      }
    }
  };

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleLocationChange = () => {
      const tabId = getTabFromPath(window.location.pathname);
      setActiveTabState(tabId);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const [developerMode, setDeveloperModeState] = useState<boolean>(() => {
    return localStorage.getItem('developerMode') === 'true';
  });

  const setDeveloperMode = (val: boolean) => {
    setDeveloperModeState(val);
    localStorage.setItem('developerMode', val ? 'true' : 'false');
  };

  const [datePickerStyle, setDatePickerStyleState] = useState<'modern' | 'klasik'>(() => {
    const saved = localStorage.getItem('datePickerStyle');
    return (saved === 'klasik' || saved === 'modern') ? saved : 'modern';
  });

  const setDatePickerStyle = (val: 'modern' | 'klasik') => {
    setDatePickerStyleState(val);
    localStorage.setItem('datePickerStyle', val);
  };

  const [instansiLogState, setInstansiLogState] = useState<InstansiLogState>(() => {
    return {
      dateStart: getTodayWIB(),
      dateEnd: getTodayWIB(),
      unorCode: '',
      selectedOPD: null,
      searchOPD: '',
      searchQuery: '',
      currentPage: 1,
      pageSize: 10,
      logs: [],
      totalElements: 0,
      totalPages: 0,
      hasLoadedOnce: false
    };
  });

  // Sync default unorCode with config on load
  React.useEffect(() => {
    if (configState.kodeInstansi || configState.kodeUnor) {
      setInstansiLogState(prev => {
        if (!prev.hasLoadedOnce && !prev.unorCode) {
          return {
            ...prev,
            unorCode: configState.kodeInstansi || configState.kodeUnor || '5.19.00.00.00'
          };
        }
        return prev;
      });
    }
  }, [configState.kodeInstansi, configState.kodeUnor]);

  return (
    <AppContext.Provider value={{
      pegawai,
      setPegawai,
      config: configState,
      setConfig,
      loginForm,
      setLoginForm,
      developerMode,
      setDeveloperMode,
      datePickerStyle,
      setDatePickerStyle,
      activeTab,
      setActiveTab,
      instansiLogState,
      setInstansiLogState,
      currentUser,
      setCurrentUser,
      userRole,
      tabPermissions,
      setTabPermissions,
      autoLoginTrigger,
      sessionVerified,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
