import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogIn, Camera, FileText, Activity, FileCheck, Database, Menu, Moon, Sun, UserCircle, ChevronLeft, ChevronRight, LogOut, X, Edit3, BarChart3, Building2, MapPin } from 'lucide-react';
import { useDarkMode } from './hooks/useDarkMode';
import { AppProvider, useAppContext } from './context/AppContext';
import { DEFAULT_ADMIN_PERMISSIONS } from './lib/userManager';
import TabLogin from './components/tabs/TabLogin';
import TabAbsen from './components/tabs/TabAbsen';
import TabLog from './components/tabs/TabLog';
import TabInputAktivitas from './components/tabs/TabInputAktivitas';
import TabAktivitas from './components/tabs/TabAktivitas';
import TabIzin from './components/tabs/TabIzin';
import TabLogPresensiInstansi from './components/tabs/TabLogPresensiInstansi';
import TabReviewProduktifitas from './components/tabs/TabReviewProduktifitas';
import TabDatabase from './components/tabs/TabDatabase';
import TabLokasi from './components/tabs/TabLokasi';
import TabReportPegawai from './components/tabs/TabReportPegawai';
import LoginScreen from './components/LoginScreen';
import PinChangeModal from './components/PinChangeModal';
import { db } from './lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { sendRequest } from './api';
import { decryptPayload } from './lib/encryption';
import { getServerLoginCache } from './lib/cacheManager';
import { loadSession, touchSession, clearSession } from './lib/sessionManager';

const TABS = [
  { id: 'tabLogin', icon: LogIn, label: 'Login Info', component: TabLogin, path: '/login-info' },
  { id: 'tabAbsen', icon: Camera, label: 'Submit Presensi', component: TabAbsen, path: '/submit-presensi' },
  { id: 'tabLog', icon: FileText, label: 'History Presensi', component: TabLog, path: '/log-presensi' },
  { id: 'tabInputAktivitas', icon: Edit3, label: 'Produktivitas Harian', component: TabInputAktivitas, path: '/input-aktivitas' },
  { id: 'tabAktivitas', icon: Activity, label: 'History Produktivitas', component: TabAktivitas, path: '/cek-aktivitas' },
  { id: 'tabReview', icon: BarChart3, label: 'Review Produktifitas', component: TabReviewProduktifitas, path: '/review' },
  { id: 'tabIzin', icon: FileCheck, label: 'History Izin', component: TabIzin, path: '/cek-izin' },
  { id: 'tabLogPresensiInstansi', icon: Building2, label: 'History Presensi Instansi', component: TabLogPresensiInstansi, path: '/log-presensi-instansi' },
  { id: 'tabDatabase', icon: Database, label: 'Database Pegawai', component: TabDatabase, path: '/database' },
  { id: 'tabLokasi', icon: MapPin, label: 'Data Lokasi', component: TabLokasi, path: '/data-lokasi' },
  { id: 'tabReport', icon: FileText, label: 'Laporan', component: TabReportPegawai, path: '/laporan' }
];

function Clock() {
  const [time, setTime] = useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hidden sm:flex items-center gap-2 text-xs font-mono bg-slate-100 dark:bg-slate-900/50 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm transition-colors">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      {time.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })} WIB
    </div>
  );
}

function MainApp({ onLogout, isDarkMode, toggleDarkMode }: { onLogout: () => void, isDarkMode: boolean, toggleDarkMode: () => void }) {
  const { pegawai, setPegawai, setConfig, setLoginForm, activeTab, setActiveTab, tabPermissions, currentUser, userRole, setCurrentUser, setTabPermissions, autoLoginTrigger } = useAppContext();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  // Filter TABS berdasarkan permissions — admin selalu tampil semua
  // ⚠️ tabLogin selalu visible untuk semua user (enforced di code)
  const visibleTabs = TABS.filter(tab => {
    if (userRole === 'admin') return true;
    if (tab.id === 'tabLogin') return true; // FORCE: tabLogin selalu visible
    return (tabPermissions as any)[tab.id] === true;
  });

  // ✅ Auto-redirect ke tabLogin jika belum login (pegawai kosong)
  React.useEffect(() => {
    if (!pegawai && activeTab !== 'tabLogin') {
      console.log('[App] Belum login, redirect ke tabLogin');
      setActiveTab('tabLogin');
    }
  }, [pegawai, activeTab, setActiveTab]);

  // Logout: setCurrentUser(null) sudah clear semua data sensitif dari memory
  const handleLogout = () => {
    setCurrentUser(null);
    setTabPermissions(DEFAULT_ADMIN_PERMISSIONS);
    onLogout();
  };

  // ─── Auto-login ke server pusat setiap kali login akun Jadhuman ─────────
  // Berjalan di level App (bukan hanya di TabLogin) agar langsung tembak
  // doLogin ke server pusat tanpa perlu buka tab Login Info terlebih dahulu.
  //
  // Alur prioritas:
  //   1. Cek cache localStorage → jika ada, pakai langsung (0ms, no network)
  //   2. Jika tidak ada cache → baca Firestore → doLogin ke server
  const lastHandledAutoLogin = React.useRef(-1);
  React.useEffect(() => {
    if (lastHandledAutoLogin.current === autoLoginTrigger) return;
    lastHandledAutoLogin.current = autoLoginTrigger;

    const runAutoLogin = async () => {
      if (pegawai) return; // sudah ada data, skip

      try {
        const jadhumanUsername = currentUser?.username ?? 'default_admin';

        // ── Cek cache localStorage terlebih dahulu ──────────────────
        const cached = getServerLoginCache(jadhumanUsername);
        if (cached && cached.serverUsername && cached.serverPassword) {
          // Data tersedia dari cache — set state langsung tanpa network call
          setLoginForm({ username: cached.serverUsername, password: cached.serverPassword });
          setPegawai(cached.pegawai);
          setConfig(prev => ({
            ...prev,
            idPegawai:    cached.config.idPegawai    || prev.idPegawai,
            deviceId:     cached.config.deviceId     || prev.deviceId,
            latitude:     cached.config.latitude     || prev.latitude,
            longitude:    cached.config.longitude    || prev.longitude,
            idLokasi:     cached.config.idLokasi     || prev.idLokasi,
            kodeInstansi: cached.config.kodeInstansi || prev.kodeInstansi,
            kodeUnor:     cached.config.kodeUnor     || prev.kodeUnor,
          }));
          return; // selesai, data dari cache
        }

        // ── Cache tidak ada → ambil dari Firestore lalu hit server ──
        const docKey = `login_${jadhumanUsername.replace(/[^a-zA-Z0-9_]/g, '_')}`;

        const docSnap = await getDoc(doc(db, 'settings', docKey));
        if (!docSnap.exists()) return;

        const storedRaw = docSnap.data();
        let stored: Record<string, any> = storedRaw;
        // Decrypt jika pakai format ENC$...$SEC
        if (storedRaw.encrypted && typeof storedRaw.encrypted === 'string') {
          const encStr: string = storedRaw.encrypted;
          if (encStr.startsWith('ENC$') && encStr.endsWith('$SEC')) {
            const decoded = decryptPayload(encStr);
            if (decoded && Object.keys(decoded).length > 0) {
              stored = decoded;
            }
          }
        }

        if (!stored.username || !stored.password) return;

        // Set form credentials
        setLoginForm({ username: stored.username, password: stored.password });

        // Tembak doLogin ke server pusat
        const payload = {
          username: stored.username,
          password: stored.password,
          versi: stored.versi || '2.0.0',
        };
        const data = await sendRequest('/login/do_LoginMobile', payload);
        if (data?.success) {
          setPegawai({ ...data, password: stored.password });
          setConfig(prev => ({
            ...prev,
            idPegawai:    data.id || data.id_pegawai || stored.idPegawai || prev.idPegawai,
            deviceId:     data.emai || data.imei || data.device_id || stored.deviceId || prev.deviceId,
            latitude:     data.lat || data.latitude || stored.latitude || prev.latitude,
            longitude:    data.long || data.longitude || data.longtitude || stored.longitude || prev.longitude,
            idLokasi:     data.id_lokasi || stored.idLokasi || prev.idLokasi,
            kodeInstansi: data.kode_instansi || stored.kodeInstansi || prev.kodeInstansi,
            kodeUnor:     data.kode_unor || stored.kodeUnor || prev.kodeUnor,
          }));
        }
      } catch (err) {
        console.error('Background auto-login error:', err);
      }
    };

    runAutoLogin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoginTrigger]);

  // Custom back button handler for modals (PinModal, MobileMenu, Lightboxes)
  React.useEffect(() => {
    const handlePopState = (_e: PopStateEvent) => {
      // 1. Run custom back handlers from bottom up (deepest modal first)
      const handlers = (window as any).customBackHandlers || [];
      if (handlers.length > 0) {
        // Restore the current URL pathname in history since the browser popped it
        const currentTabData = TABS.find(t => t.id === activeTab) || TABS[0];
        const path = currentTabData.path || '/login-info';
        window.history.pushState(null, '', path);

        const lastHandler = handlers[handlers.length - 1];
        lastHandler();
        return;
      }

      // 2. Close active page level modals
      if (isPinModalOpen) {
        setIsPinModalOpen(false);
        const currentTabData = TABS.find(t => t.id === activeTab) || TABS[0];
        window.history.pushState(null, '', currentTabData.path || '/login-info');
        return;
      }

      if (isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
        const currentTabData = TABS.find(t => t.id === activeTab) || TABS[0];
        window.history.pushState(null, '', currentTabData.path || '/login-info');
        return;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isPinModalOpen, isMobileMenuOpen, activeTab]);

  // Security: pastikan tab aktif ada dalam visibleTabs (prevent permission bypass via URL)
  const activeTabData = (() => {
    const found = TABS.find(t => t.id === activeTab);
    if (!found) return visibleTabs[0] || TABS[0];
    // Jika tab tidak ada di visibleTabs (permission dicabut), redirect ke tab pertama yang visible
    const isAllowed = userRole === 'admin' || visibleTabs.some(t => t.id === activeTab);
    if (!isAllowed) {
      const fallback = visibleTabs[0] || TABS[0];
      // Redirect URL juga
      if (typeof window !== 'undefined' && window.location.pathname !== fallback.path) {
        window.history.replaceState(null, '', fallback.path);
      }
      return fallback;
    }
    return found;
  })();
  const ActiveComponent = activeTabData.component;

  return (
    <div className="bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-sans h-[100dvh] w-full flex transition-colors duration-300 overflow-hidden relative">
      
      {/* Sidebar */}
      <aside className={`bg-slate-900 dark:bg-slate-800/95 border-r-0 lg:border-r border-slate-800 dark:border-slate-700/50 flex-col h-full fixed inset-y-0 left-0 lg:relative lg:inset-y-auto lg:left-auto lg:flex transition-all duration-300 z-40 flex shadow-xl lg:shadow-none ${isSidebarExpanded ? 'w-64' : 'w-20'} ${isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}`}>
        
        <div className={`h-16 flex items-center border-b border-slate-800 dark:border-slate-700/60 ${isSidebarExpanded || isMobileMenuOpen ? 'justify-between px-6' : 'justify-center px-0'}`}>
          <div className="flex items-center gap-3 overflow-hidden group">
            <div 
              className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-white p-1 overflow-hidden transition-transform group-hover:scale-105 cursor-pointer shadow-sm" 
              onClick={() => setIsPinModalOpen(true)}
              title="Pengaturan Password Jadhuman"
            >
              <img src="/assets/jadhuman.svg" alt="Jadhuman Logo" className="w-full h-full object-contain" />
            </div>
            {(isSidebarExpanded || isMobileMenuOpen) && (
              <span className="font-bold text-lg tracking-tight text-white whitespace-nowrap">JADHUMAN</span>
            )}
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-slate-400 hover:text-white flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toggle Sidebar Button (Desktop only) */}
        <button 
          onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
          className="hidden lg:flex absolute top-20 -right-3 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full items-center justify-center text-slate-400 hover:text-white shadow-md transition-colors z-50"
        >
          {isSidebarExpanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1.5 custom-scrollbar">
          {visibleTabs.map((tab) => {
            const isActive = tab.id === activeTab;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center rounded-lg text-left font-medium transition-all duration-200 group ${isSidebarExpanded || isMobileMenuOpen ? 'px-3 py-2.5 gap-3 text-sm' : 'justify-center p-3'} ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
                title={(!isSidebarExpanded && !isMobileMenuOpen) ? tab.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} />
                {(isSidebarExpanded || isMobileMenuOpen) && (
                  <span className="truncate">{tab.label}</span>
                )}
              </button>
            );
          })}
        </div>
        
        <div className="mt-auto p-4 border-t border-slate-800 space-y-2">
          {/* Info role user yang sedang login */}
          {(isSidebarExpanded || isMobileMenuOpen) && currentUser && (
            <div className="px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Login sebagai</p>
              <p className="text-xs font-bold text-slate-200 truncate">{currentUser.displayName || currentUser.username}</p>
              <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded mt-1 ${
                currentUser.role === 'admin'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-amber-500/20 text-amber-400'
              }`}>
                {currentUser.role}
              </span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className={`w-full flex items-center rounded-lg text-left font-medium transition-all duration-200 group text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 ${isSidebarExpanded || isMobileMenuOpen ? 'px-3 py-2.5 gap-3 text-sm' : 'justify-center p-3'}`}
            title={(!isSidebarExpanded && !isMobileMenuOpen) ? 'Keluar' : undefined}
          >
            <LogOut className={`w-5 h-5 flex-shrink-0`} />
            {(isSidebarExpanded || isMobileMenuOpen) && (
              <span className="truncate">Keluar</span>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        ></div>
      )}

      {/* Main Content Wrapper */}
      <div className={`flex-1 flex flex-col min-w-0 h-[100dvh] relative overflow-hidden transition-all duration-300 ${isMobileMenuOpen ? 'blur-sm pointer-events-none lg:blur-none lg:pointer-events-auto' : ''}`}>
        {/* Top Navbar */}
        <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 sm:px-6 transition-colors duration-300 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsMobileMenuOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white truncate max-w-[150px] sm:max-w-none">{activeTabData.label}</h2>
          </div>
          
          <div className="flex items-center gap-3 sm:gap-4">
            <Clock />
            
            {/* User Profile Badge */}
            {pegawai && (
              <button 
                onClick={() => setActiveTab('tabLogin')} 
                className="flex items-center gap-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 p-1 sm:pl-2 sm:pr-3 sm:py-1.5 rounded-full border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer text-left focus:outline-none"
              >
                {pegawai.foto ? (
                  <img 
                    src={`/api/proxy-image?path=${encodeURIComponent(pegawai.foto)}`}
                    alt={pegawai.nama} 
                    className="w-7 h-7 sm:w-6 sm:h-6 rounded-full object-cover aspect-square border border-slate-300 dark:border-slate-600 shrink-0"
                  />
                ) : (
                  <UserCircle className="w-7 h-7 sm:w-6 sm:h-6 text-slate-400" />
                )}
                <span className="hidden sm:block text-sm font-semibold text-slate-700 dark:text-slate-200 max-w-[120px] truncate">
                  {pegawai.nama?.split(' ')[0] || 'User'}
                </span>
              </button>
            )}

            <button onClick={toggleDarkMode} className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Scrollable Main Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto custom-scrollbar relative">
          <main className="flex-1 p-4 sm:p-6 lg:p-8 w-full">
            <div className="space-y-6 animate-fade-in">
              <ActiveComponent />
            </div>
          </main>
        </div>
      </div>

      <AnimatePresence>
        {isPinModalOpen && (
          <PinChangeModal onClose={() => setIsPinModalOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const { isDarkMode, toggleDarkMode } = useDarkMode();
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const session = loadSession();
    return !!session;
  });

  const redirectPath = React.useMemo(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path !== '/' && path !== '/login') {
        return path;
      }
    }
    return null;
  }, []);

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearSession();
    setIsAuthenticated(false);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/login');
    }
  };

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isAuthenticated) {
      if (window.location.pathname !== '/login') {
        window.history.replaceState(null, '', '/login');
      }
    } else {
      if (window.location.pathname === '/login' || window.location.pathname === '/') {
        const target = redirectPath || '/login-info';
        window.history.replaceState(null, '', target);
        window.dispatchEvent(new Event('popstate'));
      }
    }
  }, [isAuthenticated, redirectPath]);

  // Handle active session tracking and timeout
  React.useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return;

    const checkSession = () => {
      const session = loadSession();
      if (!session) {
        handleLogout();
      }
    };

    const resetSessionTimer = () => {
      touchSession();
    };

    // Events signaling user activity to refresh session
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => {
      window.addEventListener(event, resetSessionTimer);
    });

    // Check every 10 seconds if idle for 10 minutes
    const interval = setInterval(checkSession, 10000);

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetSessionTimer);
      });
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  return (
    <AppProvider>
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ minHeight: '100vh' }}
          >
            <LoginScreen onLogin={handleLogin} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
          </motion.div>
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ minHeight: '100vh' }}
          >
            <MainApp onLogout={handleLogout} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
          </motion.div>
        )}
      </AnimatePresence>
    </AppProvider>
  );
}
