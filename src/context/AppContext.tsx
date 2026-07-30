import React, { createContext, useContext, useState, ReactNode } from 'react';
import { getTodayWIB } from '../lib/dateFormatter';
import type { UserRole, TabPermissions, UserAccountSafe } from '../lib/userManager';
import { DEFAULT_ADMIN_PERMISSIONS } from '../lib/userManager';
import { clearServerLoginCache } from '../lib/cacheManager';
import { loadSession, saveSession, clearSession } from '../lib/sessionManager';

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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  // Inisialisasi sesi aktif dari sessionStorage (terisolasi per-tab)
  const initialSession = loadSession();

  const [currentUser, setCurrentUserState] = useState<UserAccountSafe | null>(() => {
    return initialSession ? initialSession.currentUser : null;
  });
  const currentUserRef = React.useRef<UserAccountSafe | null>(currentUser);
  const [tabPermissions, setTabPermissionsState] = useState<TabPermissions>(() => {
    return initialSession ? initialSession.tabPermissions : DEFAULT_ADMIN_PERMISSIONS;
  });
  // Counter yang di-increment setiap login Jadhuman berhasil → TabLogin watch ini untuk trigger auto-login
  const [autoLoginTrigger, setAutoLoginTrigger] = useState(0);

  // ⚠️ SECURITY: jika currentUser null (unauthenticated), userRole HARUS 'user' (bukan 'admin')!
  const userRole: UserRole = currentUser?.role ?? 'user';

  // Simpan referensi ke currentUser yang bisa dibaca secara sinkron
  // (dipakai untuk cache invalidation saat ganti akun)
  React.useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

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

  // setCurrentUser: saat dipanggil setelah login, simpan ke sessionStorage dan trigger auto-login
  const setCurrentUser = (user: UserAccountSafe | null) => {
    if (!user) {
      // Logout — bersihkan sesi tab ini dari sessionStorage & memory
      clearSession();
      setPegawaiState(null);
      setLoginFormState({ username: '', password: '' });
      setConfigState({
        idPegawai: '', deviceId: '', latitude: '', longitude: '',
        idLokasi: '', kodeInstansi: '', kodeUnor: '', workMode: '1', versi: '2.0.0'
      });
      setCurrentUserState(null);
      setTabPermissionsState(DEFAULT_ADMIN_PERMISSIONS);
      return;
    }

    // Ganti akun: hapus cache server akun sebelumnya agar tidak bocor ke akun baru
    const prevUsername = currentUserRef.current?.username ?? 'default_admin';
    const nextUsername = user.username ?? 'default_admin';
    if (prevUsername !== nextUsername) {
      clearServerLoginCache(prevUsername);
    }

    // Reset data server pusat dulu (akan diisi ulang oleh auto-login dari Firestore)
    setPegawaiState(null);
    setLoginFormState({ username: '', password: '' });
    setConfigState({
      idPegawai: '', deviceId: '', latitude: '', longitude: '',
      idLokasi: '', kodeInstansi: '', kodeUnor: '', workMode: '1', versi: '2.0.0'
    });

    const perms = user.permissions || DEFAULT_ADMIN_PERMISSIONS;
    setCurrentUserState(user);
    setTabPermissionsState(perms);
    saveSession(user, perms);
    setAutoLoginTrigger(prev => prev + 1);
  };

  const setTabPermissions = (perms: TabPermissions) => {
    setTabPermissionsState(perms);
    if (currentUser) {
      saveSession(currentUser, perms);
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
  
  const [config, setConfigState] = useState<KredensialConfig>({
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
    if (config.kodeInstansi || config.kodeUnor) {
      setInstansiLogState(prev => {
        if (!prev.hasLoadedOnce && !prev.unorCode) {
          return {
            ...prev,
            unorCode: config.kodeInstansi || config.kodeUnor || '5.19.00.00.00'
          };
        }
        return prev;
      });
    }
  }, [config.kodeInstansi, config.kodeUnor]);

  return (
    <AppContext.Provider value={{ 
      pegawai, 
      setPegawai, 
      config, 
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
