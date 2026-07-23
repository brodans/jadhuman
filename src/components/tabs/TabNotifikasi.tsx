// ============================================================
//  src/components/tabs/TabNotifikasi.tsx
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell, BellOff, CheckCircle, XCircle, Loader2, RefreshCw, Send,
  Smartphone, Monitor, Trash2, RotateCcw,
  Clock, Calendar, Save,
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  registerFCM,
  getUserDevices,
  deleteFCMDeviceFromFirestore,
  deleteAllUserFCMTokens,
  isFCMSupported,
  setupForegroundMessageListener,
  getFCMStatusMessage,
  getPlatformInfo,
} from '../../lib/fcmService';
import {
  getPresensiConfig,
  savePresensiConfig,
  schedulePresensiNotification,
  cancelPresensiNotification,
  calculateNextPresensiTarget,
  PresensiScheduleConfig,
} from '../../lib/qstashService';
import {
  saveUserNotifSettings,
  subscribeUserNotifSettings,
  getLocalNotifSettings,
} from '../../lib/notifSettingsService';

// ─── Types ────────────────────────────────────────────────────────────────────
export type DeviceItem = {
  token: string;
  tokenId: string;
  deviceInfo: string;
  platform: string;
  browser: string;
  registeredAt: string;
  lastSeen: string;
};

// ─── localStorage helpers ─────────────────────────────────────────────────────
const notifPrefKey = (userId: string) => `jadhuman_notif_enabled_${userId}`;

function getNotifPref(userId: string): boolean {
  try {
    const v = localStorage.getItem(notifPrefKey(userId));
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

function setNotifPref(userId: string, enabled: boolean) {
  try {
    localStorage.setItem(notifPrefKey(userId), enabled ? 'true' : 'false');
  } catch { /* ignore */ }
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  if (platform === 'Android' || platform === 'iOS') return <Smartphone className={className} />;
  return <Monitor className={className} />;
}

function ToggleSwitch({ enabled, loading, onChange }: {
  enabled: boolean; loading: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => !loading && onChange(!enabled)}
      disabled={loading}
      aria-label={enabled ? 'Matikan' : 'Aktifkan'}
      className={`relative inline-flex items-center w-12 h-6.5 rounded-full p-0.5 shrink-0 transition-colors duration-300 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
        enabled
          ? 'bg-blue-600 dark:bg-blue-500'
          : 'bg-slate-300 dark:bg-slate-700'
      }`}
    >
      <span
        className={`inline-block w-5.5 h-5.5 rounded-full bg-white shadow-md transform transition-transform duration-300 ease-out ${
          enabled ? 'translate-x-5.5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function StatusBadge({ registered, enabled, message }: { registered: boolean; enabled: boolean; message: string }) {
  const active = registered && enabled;
  return (
    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl text-xs font-semibold border transition-all ${
      active
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
        : enabled
          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
    }`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-emerald-500 animate-pulse' : enabled ? 'bg-slate-400' : 'bg-rose-500'}`} />
      <span className="leading-snug">{message}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TabNotifikasi() {
  const { currentUser, pegawai } = useAppContext();
  const userId = currentUser?.id ?? currentUser?.username ?? 'default_admin';

  const [notifEnabled, setNotifEnabled] = useState<boolean>(() => getNotifPref(userId));
  const [fcmRegistered, setFcmRegistered] = useState(false);
  const [fcmStatus, setFcmStatus] = useState('');
  const [hasTried, setHasTried] = useState(false);

  const [loadingToggle, setLoadingToggle] = useState(false);
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Devices
  const [userDevices, setUserDevices] = useState<DeviceItem[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [deletingToken, setDeletingToken] = useState<string | null>(null);
  const [confirmDeleteDevice, setConfirmDeleteDevice] = useState<DeviceItem | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Presensi Reminder State
  const [presensiConfig, setPresensiConfig] = useState<PresensiScheduleConfig>(() => getPresensiConfig(userId));
  const [loadingPresensiToggle, setLoadingPresensiToggle] = useState(false);
  const [savingPresensiSchedule, setSavingPresensiSchedule] = useState(false);

  // Sync Notification Settings with Firebase Firestore per userId
  useEffect(() => {
    if (!userId) return;

    // Load initial local state
    const local = getLocalNotifSettings(userId);
    setNotifEnabled(local.notifEnabled);
    setPresensiConfig(local.presensiConfig);

    // Real-time listener for Firestore document: jadhuman_notif_settings/${userId}
    const unsub = subscribeUserNotifSettings(userId, (settings) => {
      setNotifEnabled(settings.notifEnabled);
      setPresensiConfig(settings.presensiConfig);
    });

    return () => unsub();
  }, [userId]);

  // Toggle Presensi Reminder ON/OFF
  const handlePresensiToggle = async (nextEnabled: boolean) => {
    setLoadingPresensiToggle(true);
    setError(''); setSuccess('');
    try {
      const nextConfig = { ...presensiConfig, enabled: nextEnabled };
      savePresensiConfig(userId, nextConfig);
      await saveUserNotifSettings(userId, { presensiConfig: nextConfig });
      setPresensiConfig(nextConfig);

      const userName = pegawai?.nama || currentUser?.displayName || currentUser?.username || 'User';

      if (!nextEnabled) {
        await cancelPresensiNotification({ userId });
        setSuccess('🔕 Reminder Presensi dimatikan.');
      } else {
        if (!fcmRegistered && Notification.permission !== 'granted') {
          setError('⚠️ Izinkan notifikasi browser dan daftarkan device terlebih dahulu.');
          setLoadingPresensiToggle(false);
          return;
        }
        await schedulePresensiNotification({ userId, userName, config: nextConfig });
        const target = calculateNextPresensiTarget(nextConfig);
        if (target) {
          const typeLabel = target.presensiType === 'checkin' ? 'Masuk' : 'Pulang';
          setSuccess(`✅ Reminder Presensi aktif! Notifikasi berikutnya: Presensi ${typeLabel} (${target.dayName} ${target.presensiTime}).`);
        } else {
          setSuccess('✅ Reminder Presensi berhasil diaktifkan.');
        }
      }
    } catch (err: any) {
      setError(`❌ ${err?.message || 'Gagal mengubah reminder presensi'}`);
    } finally {
      setLoadingPresensiToggle(false);
    }
  };

  // Simpan jam presensi masuk & pulang
  const handleSavePresensiTimes = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPresensiSchedule(true);
    setError(''); setSuccess('');
    try {
      savePresensiConfig(userId, presensiConfig);
      await saveUserNotifSettings(userId, { presensiConfig });
      const userName = pegawai?.nama || currentUser?.displayName || currentUser?.username || 'User';

      if (presensiConfig.enabled) {
        await schedulePresensiNotification({ userId, userName, config: presensiConfig });
        const target = calculateNextPresensiTarget(presensiConfig);
        if (target) {
          const typeLabel = target.presensiType === 'checkin' ? 'Masuk' : 'Pulang';
          setSuccess(`✅ Pengaturan jam presensi disimpan! Notifikasi berikutnya: Presensi ${typeLabel} (${target.dayName} ${target.presensiTime}).`);
        } else {
          setSuccess('✅ Pengaturan jam presensi berhasil disimpan.');
        }
      } else {
        setSuccess('✅ Pengaturan jam presensi disimpan.');
      }
    } catch (err: any) {
      setError(`❌ ${err?.message || 'Gagal menyimpan jam presensi'}`);
    } finally {
      setSavingPresensiSchedule(false);
    }
  };

  const currentTokenRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Auto-clear messages
  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => { setError(''); setSuccess(''); }, 6000);
    return () => clearTimeout(t);
  }, [error, success]);

  // Helper deduplikasi device di UI
  const deduplicateDevices = (rawList: any[]): DeviceItem[] => {
    const map = new Map<string, DeviceItem>();
    (rawList || []).forEach((d: any) => {
      const token = d.token || '';
      const tokenId = d.tokenId || (token ? token.substring(0, 20) + '...' : '');
      const key = token || tokenId;
      if (key) {
        map.set(key, {
          token,
          tokenId,
          deviceInfo: d.deviceInfo || 'Unknown',
          platform: d.platform || '',
          browser: d.browser || '',
          registeredAt: d.registeredAt || '',
          lastSeen: d.lastSeen || '',
        });
      }
    });
    return Array.from(map.values());
  };

  // ── Fetch devices ────────────────────────────────────────────────────────
  const fetchDevices = useCallback(async () => {
    try {
      const r = await fetch(`/api/debug-devices?userId=${encodeURIComponent(userId)}`);
      if (r.ok) {
        const data = await r.json();
        const devices = deduplicateDevices(data.devices || []);
        setUserDevices(devices);
        setFcmRegistered(devices.length > 0);
        setLoadingDevices(false);
        return;
      }
    } catch (e) {
      console.warn('[TabNotifikasi] fetchDevices API error:', e);
    }

    try {
      const rawDevices = await getUserDevices(userId);
      const devices = deduplicateDevices(rawDevices);
      setUserDevices(devices);
      setFcmRegistered(devices.length > 0);
    } catch (err) {
      console.error('[TabNotifikasi] Fallback getUserDevices failed:', err);
    } finally {
      setLoadingDevices(false);
    }
  }, [userId]);

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    fetchDevices();

    let pollingInterval: ReturnType<typeof setInterval> | null = null;

    const setupListener = async () => {
      try {
        const docRef = doc(db, 'jadhuman_fcm_tokens', userId);
        const unsub = onSnapshot(
          docRef,
          (snapshot) => {
            if (!snapshot.exists()) {
              setUserDevices([]);
              setFcmRegistered(false);
              setLoadingDevices(false);
              return;
            }
            const data = snapshot.data();
            const devices = deduplicateDevices(data?.devices || []);
            setUserDevices(devices);
            setFcmRegistered(devices.length > 0);
            setLoadingDevices(false);
          },
          (_err) => {
            setLoadingDevices(false);
            if (!pollingInterval) {
              pollingInterval = setInterval(fetchDevices, 15_000);
            }
          }
        );

        unsubscribeRef.current = unsub;
      } catch (_err) {
        setLoadingDevices(false);
        if (!pollingInterval) {
          pollingInterval = setInterval(fetchDevices, 15_000);
        }
      }
    };

    setupListener();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [userId, fetchDevices]);

  // ── Auto register ──────────────────────────────────────────────────────────
  const tryAutoRegister = useCallback(async () => {
    const pref = getNotifPref(userId);
    if (!pref) {
      setNotifEnabled(false);
      setFcmStatus('Notifikasi dimatikan.');
      setHasTried(true);
      return;
    }
    if (!isFCMSupported()) {
      setFcmStatus(getFCMStatusMessage());
      setHasTried(true);
      return;
    }
    if (Notification.permission !== 'granted') {
      setFcmStatus(getFCMStatusMessage());
      setHasTried(true);
      return;
    }
    try {
      const token = await registerFCM(userId);
      if (token) {
        currentTokenRef.current = token;
        setFcmStatus('Notifikasi aktif.');
        setupForegroundMessageListener(() => {});
      } else {
        setFcmStatus(getFCMStatusMessage());
      }
    } catch {
      setFcmStatus(getFCMStatusMessage());
    }
    setHasTried(true);
  }, [userId]);

  useEffect(() => { tryAutoRegister(); }, [tryAutoRegister]);

  // ── Toggle ON/OFF ──────────────────────────────────────────────────────────
  const handleToggle = async (next: boolean) => {
    setLoadingToggle(true);
    setError(''); setSuccess('');
    try {
      if (!next) {
        await deleteAllUserFCMTokens(userId);
        currentTokenRef.current = null;
        setNotifPref(userId, false);
        await saveUserNotifSettings(userId, { notifEnabled: false });
        setNotifEnabled(false);
        setFcmStatus('Notifikasi dimatikan.');
        setSuccess('🔕 Notifikasi dimatikan.');
        setTimeout(fetchDevices, 500);
      } else {
        setNotifPref(userId, true);
        await saveUserNotifSettings(userId, { notifEnabled: true });
        setNotifEnabled(true);
        if (!isFCMSupported()) {
          setFcmStatus(getFCMStatusMessage());
          setError('❌ Push notification tidak didukung di browser ini.');
          setNotifPref(userId, false);
          await saveUserNotifSettings(userId, { notifEnabled: false });
          setNotifEnabled(false);
          return;
        }
        const token = await registerFCM(userId);
        if (token) {
          currentTokenRef.current = token;
          setFcmStatus('Notifikasi aktif.');
          setupForegroundMessageListener(() => {});
          setSuccess('✅ Notifikasi berhasil diaktifkan!');
          setTimeout(fetchDevices, 500);
        } else {
          const msg = getFCMStatusMessage();
          setFcmStatus(msg);
          setNotifPref(userId, false);
          await saveUserNotifSettings(userId, { notifEnabled: false });
          setNotifEnabled(false);
          setError(`❌ Gagal mengaktifkan notifikasi. ${msg}`);
        }
      }
    } catch (err: any) {
      setError(`❌ ${err?.message ?? 'Terjadi kesalahan'}`);
    } finally {
      setLoadingToggle(false);
    }
  };

  // ── Daftarkan device ini ───────────────────────────────────────────────────
  const handleRegister = async () => {
    setLoadingRegister(true);
    setError(''); setSuccess('');
    try {
      const token = await registerFCM(userId);
      if (token) {
        currentTokenRef.current = token;
        setFcmStatus('Notifikasi aktif.');
        setupForegroundMessageListener(() => {});
        setSuccess('✅ Device berhasil terdaftar.');
        setTimeout(fetchDevices, 500);
      } else {
        const msg = getFCMStatusMessage();
        setFcmStatus(msg);
        setError(`❌ Gagal daftarkan device. ${msg}`);
      }
    } catch (err: any) {
      setError(`❌ ${err?.message ?? 'Terjadi kesalahan'}`);
    } finally {
      setLoadingRegister(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = async () => {
    setShowResetConfirm(false);
    setLoadingReset(true);
    setError(''); setSuccess('');
    try {
      await deleteAllUserFCMTokens(userId);
      currentTokenRef.current = null;
      const token = await registerFCM(userId);
      if (token) {
        currentTokenRef.current = token;
        setNotifPref(userId, true);
        setNotifEnabled(true);
        setFcmStatus('Notifikasi aktif.');
        setupForegroundMessageListener(() => {});
        setSuccess('✅ Reset berhasil! Device ini terdaftar ulang.');
        setTimeout(fetchDevices, 500);
      } else {
        const msg = getFCMStatusMessage();
        setFcmStatus(msg);
        setError(`❌ Reset berhasil tapi gagal daftarkan ulang. ${msg}`);
        setTimeout(fetchDevices, 500);
      }
    } catch (err: any) {
      setError(`❌ ${err?.message ?? 'Gagal reset'}`);
    } finally {
      setLoadingReset(false);
    }
  };

  // ── Hapus device ───────────────────────────────────────────────────────────
  const handleRemoveDevice = async (token: string) => {
    setDeletingToken(token);
    const isCurrentDevice = token === currentTokenRef.current;
    try {
      const ok = await deleteFCMDeviceFromFirestore(userId, token);
      if (ok) {
        if (isCurrentDevice) {
          currentTokenRef.current = null;
          setFcmRegistered(false);
          setFcmStatus('Device ini dihapus.');
          setSuccess('✅ Device ini dihapus.');
        } else {
          setSuccess('✅ Device berhasil dihapus.');
        }
        setTimeout(fetchDevices, 500);
      } else {
        setError('❌ Gagal menghapus device.');
      }
    } catch (err: any) {
      setError(`❌ ${err?.message ?? 'Gagal menghapus device'}`);
    } finally {
      setDeletingToken(null);
      setConfirmDeleteDevice(null);
    }
  };

  // ── Test notifikasi ────────────────────────────────────────────────────────
  const [loadingTestProductivity, setLoadingTestProductivity] = useState(false);
  const [loadingTestPresensi, setLoadingTestPresensi] = useState(false);

  const handleTestNotification = async (testType: 'productivity' | 'presensi') => {
    if (testType === 'presensi') setLoadingTestPresensi(true);
    else setLoadingTestProductivity(true);
    setError(''); setSuccess('');
    try {
      const userName = pegawai?.nama || currentUser?.displayName || currentUser?.username;
      const response = await fetch('/api/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, userName, testType }),
      });
      const data = await response.json();
      const typeTitle = testType === 'presensi' ? 'Presensi' : 'Produktivitas';

      if (response.ok && data.success) {
        setSuccess(`✅ Tes Notifikasi ${typeTitle} terkirim!`);
      } else {
        setError(`❌ Gagal kirim tes ${typeTitle}: ${data.error || 'Terjadi kesalahan'}`);
      }
    } catch (err: any) {
      setError(`❌ ${err?.message ?? 'Terjadi kesalahan'}`);
    } finally {
      setLoadingTestPresensi(false);
      setLoadingTestProductivity(false);
    }
  };

  const platform = getPlatformInfo();
  const isSupported = isFCMSupported();
  const isActive = notifEnabled && fcmRegistered;

  const currentPlatformName = platform.isAndroid ? 'Android'
    : platform.isIOS ? 'iOS'
    : /Windows/.test(navigator.userAgent) ? 'Windows'
    : /Mac/.test(navigator.userAgent) ? 'macOS'
    : 'Linux';

  return (
    <div className="w-full max-w-md mx-auto space-y-4 pb-8">

      {/* ── Header Card ── */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/80 dark:border-slate-700/60 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
              isActive
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'bg-slate-100 dark:bg-slate-700/60 text-slate-400 dark:text-slate-400'
            }`}>
              {isActive ? <Bell className="w-5.5 h-5.5" /> : <BellOff className="w-5.5 h-5.5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Pengaturan Notifikasi</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Pengingat jam kerja & presensi</p>
            </div>
          </div>
        </div>

        {/* Alert banners */}
        {error && (
          <div className="p-3.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold rounded-2xl flex items-start gap-2.5 animate-in fade-in duration-150">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed whitespace-pre-line">{error}</span>
          </div>
        )}
        {success && (
          <div className="p-3.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 text-xs font-semibold rounded-2xl flex items-start gap-2.5 animate-in fade-in duration-150">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed whitespace-pre-line">{success}</span>
          </div>
        )}

        {/* Toggle 1: Produktivitas */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 flex items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0 pr-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900 dark:text-white">Pengingat Produktivitas</span>
              <span className="text-[9px] font-extrabold uppercase tracking-wider bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded">2 Jam</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Notifikasi batas waktu 2 jam produktivitas harian</p>
          </div>
          <ToggleSwitch enabled={notifEnabled} loading={loadingToggle} onChange={handleToggle} />
        </div>

        {/* Toggle 2 & Form: Presensi */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0 pr-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-900 dark:text-white">Pengingat Presensi</span>
                <span className="text-[9px] font-extrabold uppercase tracking-wider bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">Reminder</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Notifikasi otomatis jam masuk & pulang</p>
            </div>
            <ToggleSwitch enabled={presensiConfig.enabled} loading={loadingPresensiToggle} onChange={handlePresensiToggle} />
          </div>

          {presensiConfig.enabled && (
            <form onSubmit={handleSavePresensiTimes} className="pt-3.5 border-t border-slate-200/80 dark:border-slate-700/50 space-y-3.5">
              {/* Stack Vertikal: Senin-Kamis DI ATAS, Jumat DI BAWAH */}
              <div className="flex flex-col gap-3">
                {/* Card Senin - Kamis (Di Atas) */}
                <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/90 dark:border-slate-700/70 space-y-2 shadow-xs">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-700/50">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      Senin – Kamis
                    </span>
                    <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-md">
                      4 Hari
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                        Jam Masuk
                      </label>
                      <input
                        type="time"
                        value={presensiConfig.seninKamisMasuk}
                        onChange={(e) => setPresensiConfig({ ...presensiConfig, seninKamisMasuk: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-mono font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-center"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                        Jam Pulang
                      </label>
                      <input
                        type="time"
                        value={presensiConfig.seninKamisPulang}
                        onChange={(e) => setPresensiConfig({ ...presensiConfig, seninKamisPulang: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-mono font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-center"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Card Jumat (Di Bawah) */}
                <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/90 dark:border-slate-700/70 space-y-2 shadow-xs">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-700/50">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      Jumat
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-md">
                      1 Hari
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                        Jam Masuk
                      </label>
                      <input
                        type="time"
                        value={presensiConfig.jumatMasuk}
                        onChange={(e) => setPresensiConfig({ ...presensiConfig, jumatMasuk: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-mono font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-center"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                        Jam Pulang
                      </label>
                      <input
                        type="time"
                        value={presensiConfig.jumatPulang}
                        onChange={(e) => setPresensiConfig({ ...presensiConfig, jumatPulang: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-mono font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-center"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Target Notifikasi Presensi Berikutnya */}
              {(() => {
                const nextTarget = calculateNextPresensiTarget(presensiConfig);
                if (!nextTarget) return null;
                const typeLabel = nextTarget.presensiType === 'checkin' ? 'Masuk' : 'Pulang';
                return (
                  <div className="p-3 bg-blue-50/90 dark:bg-blue-900/25 border border-blue-200/90 dark:border-blue-700/60 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs shadow-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-800/60 flex items-center justify-center shrink-0">
                        <Clock className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-blue-950 dark:text-blue-100 text-xs">
                          Target Notifikasi Presensi Berikutnya
                        </p>
                        <p className="text-[11px] text-blue-700 dark:text-blue-300 font-medium truncate">
                          Presensi {typeLabel} ({nextTarget.dayName} jam <span className="font-mono font-bold">{nextTarget.presensiTime}</span>)
                        </p>
                      </div>
                    </div>
                    <span className="text-[9px] font-extrabold uppercase tracking-wider bg-blue-600 text-white px-2 py-0.5 rounded-full shrink-0 self-end sm:self-center">
                      Auto Reminder
                    </span>
                  </div>
                );
              })()}

              <button
                type="submit"
                disabled={savingPresensiSchedule}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {savingPresensiSchedule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Simpan Jam Presensi</span>
              </button>
            </form>
          )}
        </div>

        {/* Status Badge */}
        {hasTried && (
          <StatusBadge
            registered={fcmRegistered}
            enabled={notifEnabled}
            message={fcmStatus || (isActive ? 'Notifikasi aktif' : notifEnabled ? 'Belum terdaftar' : 'Notifikasi dimatikan')}
          />
        )}

        {/* Register & Test Actions */}
        {notifEnabled && (
          <div className="space-y-2 pt-1">
            {userDevices.length === 0 ? (
              <button
                onClick={handleRegister}
                disabled={loadingRegister || !isSupported}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-2xl shadow-sm transition-all flex items-center justify-center gap-2 text-xs"
              >
                {loadingRegister ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                <span>Daftarkan Device Ini</span>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleTestNotification('productivity')}
                    disabled={loadingTestProductivity || loadingTestPresensi}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 px-3 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5"
                  >
                    {loadingTestProductivity ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>Tes Produktivitas</span>
                  </button>

                  <button
                    onClick={() => handleTestNotification('presensi')}
                    disabled={loadingTestProductivity || loadingTestPresensi}
                    className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold py-2.5 px-3 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5"
                  >
                    {loadingTestPresensi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                    <span>Tes Presensi</span>
                  </button>
                </div>

                <button
                  onClick={handleRegister}
                  disabled={loadingRegister}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 rounded-xl transition-colors text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  {loadingRegister ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Refresh Device Ini</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Card Devices ── */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/80 dark:border-slate-700/60 shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <span>Perangkat Terdaftar</span>
            {userDevices.length > 0 && (
              <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                {userDevices.length}
              </span>
            )}
          </p>
          {userDevices.length > 0 && (
            <button
              onClick={() => setShowResetConfirm(true)}
              disabled={loadingReset}
              className="text-[11px] font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
            >
              {loadingReset ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              <span>Reset</span>
            </button>
          )}
        </div>

        {loadingDevices ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span>Memuat perangkat...</span>
          </div>
        ) : userDevices.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-400">
            Belum ada perangkat terdaftar.
          </div>
        ) : (
          <div className="space-y-2">
            {userDevices.map((device) => {
              const isThisDevice = device.token === currentTokenRef.current;
              return (
                <div
                  key={device.token}
                  className={`flex items-center justify-between p-3 rounded-2xl border transition-colors ${
                    isThisDevice
                      ? 'bg-blue-50/60 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/50'
                      : 'bg-slate-50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-700/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <PlatformIcon platform={device.platform} className={`w-4 h-4 shrink-0 ${isThisDevice ? 'text-blue-600' : 'text-slate-400'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {device.deviceInfo}
                        </p>
                        {isThisDevice && (
                          <span className="text-[9px] font-extrabold uppercase bg-blue-600 text-white px-1.5 py-0.2 rounded">
                            Ini
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate font-mono mt-0.5">{device.tokenId}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setConfirmDeleteDevice(device)}
                    disabled={!!deletingToken}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  >
                    {deletingToken === device.token ? <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer info platform */}
        <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span>{currentPlatformName}</span>
          <span>{isSupported ? '● Push Supported' : '○ Not Supported'}</span>
        </div>
      </div>

      {/* ── Modal Konfirmasi Hapus Device ── */}
      {confirmDeleteDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4" onClick={() => setConfirmDeleteDevice(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 w-full max-w-xs space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Hapus Perangkat?</p>
            <p className="text-xs text-slate-500">{confirmDeleteDevice.deviceInfo}</p>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setConfirmDeleteDevice(null)} className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold">Batal</button>
              <button onClick={() => handleRemoveDevice(confirmDeleteDevice.token)} className="flex-1 py-2 bg-rose-500 text-white rounded-xl text-xs font-bold">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Konfirmasi Reset ── */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4" onClick={() => setShowResetConfirm(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 w-full max-w-xs space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Reset Semua Perangkat?</p>
            <p className="text-xs text-slate-500">Semua perangkat terdaftar akan dihapus dari server.</p>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold">Batal</button>
              <button onClick={handleReset} className="flex-1 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold">Reset</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
