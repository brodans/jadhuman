// ============================================================
//  src/components/tabs/TabNotifikasi.tsx
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell, BellOff, CheckCircle, XCircle, Loader2, RefreshCw, Send,
  Smartphone, Monitor, Trash2, RotateCcw,
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

  // Sync Notification Settings with Firebase Firestore per userId
  useEffect(() => {
    if (!userId) return;

    const local = getLocalNotifSettings(userId);
    setNotifEnabled(local.notifEnabled);

    const unsub = subscribeUserNotifSettings(userId, (settings) => {
      setNotifEnabled(settings.notifEnabled);
    });

    return () => unsub();
  }, [userId]);

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

  // ── Test notifikasi produktivitas ──────────────────────────────────────────
  const [loadingTest, setLoadingTest] = useState(false);

  const handleTestNotification = async () => {
    setLoadingTest(true);
    setError(''); setSuccess('');
    try {
      const userName = pegawai?.nama || currentUser?.displayName || currentUser?.username;
      const response = await fetch('/api/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, userName }),
      });
      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess('✅ Tes Notifikasi Produktivitas terkirim!');
      } else {
        setError(`❌ Gagal kirim tes: ${data.error || 'Terjadi kesalahan'}`);
      }
    } catch (err: any) {
      setError(`❌ ${err?.message ?? 'Terjadi kesalahan'}`);
    } finally {
      setLoadingTest(false);
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
              <p className="text-xs text-slate-500 dark:text-slate-400">Pengingat jam kerja produktivitas</p>
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

        {/* Toggle: Produktivitas */}
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
                <button
                  onClick={handleTestNotification}
                  disabled={loadingTest}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 px-3 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5"
                >
                  {loadingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Tes Notifikasi Produktivitas</span>
                </button>

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
