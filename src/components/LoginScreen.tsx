import React, { useState, useEffect, useReducer, useRef } from 'react';
import {
  Lock, LogIn, AlertCircle,
  Eye, EyeOff, Clock, CheckCircle2,
  Sun, Moon, User, ShieldAlert
} from 'lucide-react';
import { verifyPinLayered, decryptAppCredential } from '../lib/encryption';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { verifyUserPassword, sanitizeString, DEFAULT_ADMIN_PERMISSIONS } from '../lib/userManager';
import type { UserAccountSafe, TabPermissions } from '../lib/userManager';
import { useAppContext } from '../context/AppContext';
import { createAdminUserAccount, saveSession } from '../lib/sessionManager';

interface LoginScreenProps {
  onLogin: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

// ─── Rate limiting ───────────────────────────────────────────────
const MAX_ATTEMPTS      = 5;
const COOLDOWN_MS       = 5 * 60 * 1000;
const MAX_USERNAME_LEN  = 32;
const MAX_PASSWORD_LEN  = 128;
const MIN_AUTH_DELAY_MS = 800; // timing-safe minimum response
const LS_ATTEMPTS       = 'jadhuman_login_attempts';
const LS_COOLDOWN       = 'jadhuman_cooldown_until';

// ─── Auth reducer ────────────────────────────────────────────────
type AuthStatus = 'IDLE' | 'AUTHENTICATING' | 'LOCKED' | 'SUCCESS';

interface AuthState {
  status: AuthStatus;
  username: string;
  pin: string;
  attempts: number;
  cooldownUntil: number | null;
  errorMessage: string | null;
}

type AuthAction =
  | { type: 'SET_USERNAME'; payload: string }
  | { type: 'SET_PIN'; payload: string }
  | { type: 'START_AUTH' }
  | { type: 'AUTH_SUCCESS' }
  | { type: 'AUTH_FAILED'; payload: { attempts: number; cooldownUntil?: number; errorMsg: string } }
  | { type: 'UPDATE_COOLDOWN'; payload: number | null };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_USERNAME':
      return { ...state, username: action.payload.substring(0, MAX_USERNAME_LEN) };
    case 'SET_PIN':
      return { ...state, pin: action.payload.substring(0, MAX_PASSWORD_LEN) };
    case 'START_AUTH':
      return { ...state, status: 'AUTHENTICATING', errorMessage: null };
    case 'AUTH_SUCCESS':
      return { ...state, status: 'SUCCESS', pin: '', errorMessage: null };
    case 'AUTH_FAILED':
      return {
        ...state,
        status: action.payload.cooldownUntil ? 'LOCKED' : 'IDLE',
        attempts: action.payload.attempts,
        cooldownUntil: action.payload.cooldownUntil ?? state.cooldownUntil,
        errorMessage: action.payload.errorMsg,
        pin: '',
      };
    case 'UPDATE_COOLDOWN':
      return {
        ...state,
        cooldownUntil: action.payload,
        status: action.payload && action.payload > Date.now() ? 'LOCKED' : 'IDLE',
      };
    default:
      return state;
  }
}

// ─── Input sanitizers ────────────────────────────────────────────
function sanitizeUsername(val: string): string {
  return sanitizeString(val, MAX_USERNAME_LEN).toLowerCase().replace(/\s/g, '');
}
function sanitizePassword(val: string): string {
  return val.replace(/[\x00-\x1F\x7F]/g, '').substring(0, MAX_PASSWORD_LEN);
}

// ─── Main Component ──────────────────────────────────────────────
export default function LoginScreen({ onLogin, isDarkMode, toggleDarkMode }: LoginScreenProps) {
  const { setCurrentUser, setTabPermissions } = useAppContext();

  const [state, dispatch] = useReducer(authReducer, {
    status: 'IDLE', username: '', pin: '',
    attempts: 0, cooldownUntil: null, errorMessage: null,
  });

  const [showPin, setShowPin] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const authInFlight = useRef(false);

  // ── Restore lockout dari localStorage ─────────────────────────
  useEffect(() => {
    const savedAttempts = parseInt(localStorage.getItem(LS_ATTEMPTS) || '0', 10);
    const savedCooldown = parseInt(localStorage.getItem(LS_COOLDOWN) || '0', 10);
    if (savedCooldown && savedCooldown > Date.now()) {
      dispatch({ type: 'AUTH_FAILED', payload: { attempts: savedAttempts, cooldownUntil: savedCooldown, errorMsg: 'Sistem terkunci sementara.' } });
    } else if (savedAttempts > 0) {
      localStorage.setItem(LS_ATTEMPTS, '0');
      localStorage.removeItem(LS_COOLDOWN);
    }
  }, []);

  // ── Countdown ─────────────────────────────────────────────────
  useEffect(() => {
    let iv: NodeJS.Timeout;
    if (state.cooldownUntil && state.cooldownUntil > Date.now()) {
      iv = setInterval(() => {
        const rem = Math.ceil((state.cooldownUntil! - Date.now()) / 1000);
        if (rem <= 0) {
          setTimeLeft(0);
          dispatch({ type: 'UPDATE_COOLDOWN', payload: null });
          localStorage.removeItem(LS_COOLDOWN);
          localStorage.setItem(LS_ATTEMPTS, '0');
        } else setTimeLeft(rem);
      }, 1000);
    }
    return () => clearInterval(iv);
  }, [state.cooldownUntil]);

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ── Auth handler ───────────────────────────────────────────────
  const handleAuthentication = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (authInFlight.current) return;
    if (state.status === 'LOCKED' || state.cooldownUntil) {
      dispatch({ type: 'AUTH_FAILED', payload: { attempts: state.attempts, errorMsg: `Akses ditolak. Tunggu ${fmtTime(timeLeft)}.` } });
      return;
    }

    const uname = sanitizeUsername(state.username);
    const pass  = sanitizePassword(state.pin);

    if (!pass) {
      dispatch({ type: 'AUTH_FAILED', payload: { attempts: state.attempts, errorMsg: 'Kata sandi tidak boleh kosong.' } });
      return;
    }

    authInFlight.current = true;
    dispatch({ type: 'START_AUTH' });
    const t0 = Date.now();

    try {
      let authenticated = false;
      let loginAsUser: UserAccountSafe | null = null;
      let loginPermissions: TabPermissions = DEFAULT_ADMIN_PERMISSIONS;

      // ═══ STEP 1: Cek admin via Firebase settings/auth ════════
      // Semua credential admin (username & password) tersimpan di Firebase.
      // Tidak ada nilai hardcode — first-time setup harus lewat Firebase Console.
      const authRef = doc(db, 'settings', 'auth');
      const authSnap = await getDoc(authRef);

      if (authSnap.exists()) {
        const data = authSnap.data();

        // Ambil adminUsername dari Firebase (field adminUsername)
        // Boleh kosong saat login jika belum diset (backward compat)
        const storedAdminUser = typeof data.adminUsername === 'string'
          ? data.adminUsername.toLowerCase().trim()
          : '';

        // Username cocok jika:
        // - Input kosong AND adminUsername tidak diset (first-time) → boleh
        // - Input sama dengan storedAdminUsername
        const usernameOk = storedAdminUser
          ? uname === storedAdminUser
          : !uname; // kalau belum ada adminUsername, hanya boleh kosong

        if (usernameOk) {
          // Verifikasi password — coba pinEncrypted dulu (AES, legacy migration)
          if (data.pinEncrypted) {
            try {
              const dec = decryptAppCredential(data.pinEncrypted);
              if (dec && dec === pass) authenticated = true;
            } catch { /* ignore */ }
          }
          // Fallback ke bcrypt pinHash
          if (!authenticated && data.pinHash) {
            if (verifyPinLayered(pass, data.pinHash)) authenticated = true;
          }
        }

        if (authenticated) {
          const storedAdminUser = typeof data.adminUsername === 'string'
            ? data.adminUsername.toLowerCase().trim()
            : '';
          loginAsUser = createAdminUserAccount(storedAdminUser || uname || 'admin');
          loginPermissions = DEFAULT_ADMIN_PERMISSIONS;
        }
      }
      // Jika settings/auth belum ada di Firebase sama sekali:
      // tidak ada fallback hardcode — admin harus setup via Firebase Console dulu.
      // Ini lebih aman daripada hardcode default credentials.

      // ═══ STEP 2: Cek role user dari jadhuman_users ════════════
      // Hanya jika step 1 gagal DAN ada username yang diisi
      if (!authenticated && uname) {
        const userSafe = await verifyUserPassword(uname, pass);
        if (userSafe) {
          authenticated = true;
          loginAsUser = userSafe;
          loginPermissions = userSafe.permissions;
        }
      }

      // ── Pastikan response time minimal (timing-safe) ───────────
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_AUTH_DELAY_MS) {
        await new Promise(r => setTimeout(r, MIN_AUTH_DELAY_MS - elapsed));
      }

      if (authenticated && loginAsUser) {
        localStorage.setItem(LS_ATTEMPTS, '0');
        localStorage.removeItem(LS_COOLDOWN);
        setCurrentUser(loginAsUser);
        setTabPermissions(loginPermissions);
        saveSession(loginAsUser, loginPermissions);
        dispatch({ type: 'AUTH_SUCCESS' });
        setTimeout(() => onLogin(), 900);
      } else {
        throw new Error('invalid_credentials');
      }

    } catch {
      // Timing-safe pada gagal juga
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_AUTH_DELAY_MS) {
        await new Promise(r => setTimeout(r, MIN_AUTH_DELAY_MS - elapsed));
      }
      const nextAttempts = state.attempts + 1;
      localStorage.setItem(LS_ATTEMPTS, String(nextAttempts));
      if (nextAttempts >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + COOLDOWN_MS;
        localStorage.setItem(LS_COOLDOWN, String(lockUntil));
        dispatch({ type: 'AUTH_FAILED', payload: { attempts: nextAttempts, cooldownUntil: lockUntil, errorMsg: 'Terlalu banyak percobaan gagal. Sistem dikunci 5 menit.' } });
      } else {
        dispatch({ type: 'AUTH_FAILED', payload: { attempts: nextAttempts, errorMsg: `Kredensial salah. ${MAX_ATTEMPTS - nextAttempts} percobaan tersisa.` } });
      }
    } finally {
      authInFlight.current = false;
    }
  };

  const isLocked  = state.status === 'LOCKED';
  const isAuthing = state.status === 'AUTHENTICATING';
  const canSubmit = !isLocked && !isAuthing && state.pin.length > 0;

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center p-6 transition-colors duration-700 font-sans overflow-hidden bg-slate-100 dark:bg-slate-950">

      {/* Theme Toggle */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={toggleDarkMode}
          className="p-3 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all active:scale-95 cursor-pointer flex items-center justify-center"
          aria-label="Toggle tema"
        >
          {isDarkMode ? <Sun className="w-5 h-5 text-amber-500 animate-pulse" /> : <Moon className="w-5 h-5 text-slate-600" />}
        </button>
      </div>

      {/* Ambient BG */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-500/10 dark:bg-blue-600/10 blur-[120px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/10 dark:bg-indigo-600/10 blur-[120px] animate-pulse" style={{ animationDuration: '10s' }} />
      </div>

      {/* Card */}
      <div className="w-full max-w-[26rem] bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl shadow-slate-200/50 dark:shadow-black/50 border border-slate-100 dark:border-slate-800 z-10 relative flex flex-col overflow-hidden">

        {/* Branding */}
        <div className="px-8 pt-12 pb-8 text-center">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-100 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-full rotate-3 scale-105 opacity-50" />
            <div className="relative w-full h-full bg-white rounded-full shadow-xl flex items-center justify-center border border-slate-100 dark:border-slate-700/50 p-4">
              <img src="/assets/jadhuman.svg" alt="Jadhuman Logo" className="w-full h-full object-contain" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 tracking-tight">
            JADHUMAN
          </h1>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className="h-px w-6 bg-slate-200 dark:bg-slate-700" />
            <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-[0.25em]">Ayo Jadhum Rek</p>
            <span className="h-px w-6 bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>

        {/* Form */}
        <div className="px-8 pb-12 relative">

          {/* Success overlay */}
          {state.status === 'SUCCESS' && (
            <div className="absolute inset-0 z-20 bg-white dark:bg-slate-900 flex flex-col justify-center items-center rounded-b-[2.5rem] animate-in fade-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Akses Diberikan</h2>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <div className="w-4 h-4 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin" />
                <p className="text-sm font-medium">Mengalihkan...</p>
              </div>
            </div>
          )}

          <form onSubmit={handleAuthentication} className="space-y-5" autoComplete="off">

            {/* Alert */}
            {state.errorMessage && (
              <div role="alert" className={`flex items-start gap-3 p-4 rounded-2xl text-sm font-medium shadow-sm border-l-4 animate-in fade-in slide-in-from-top-2 duration-200 ${
                isLocked
                  ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500 dark:text-rose-400'
                  : 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500 dark:text-amber-400'
              }`}>
                {isLocked ? <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
                <span className="leading-relaxed">{state.errorMessage}</span>
              </div>
            )}

            {/* Username */}
            <div className="space-y-2">
              <label htmlFor="login-username" className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest px-1">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <User className="h-5 w-5" />
                </div>
                <input
                  id="login-username"
                  type="text"
                  value={state.username}
                  disabled={isLocked || isAuthing}
                  onChange={e => dispatch({ type: 'SET_USERNAME', payload: e.target.value })}
                  onPaste={e => {
                    e.preventDefault();
                    const pasted = e.clipboardData.getData('text').substring(0, MAX_USERNAME_LEN);
                    dispatch({ type: 'SET_USERNAME', payload: pasted });
                  }}
                  className={`block w-full pl-12 pr-4 py-3.5 rounded-2xl text-sm font-medium transition-all duration-200 border ${
                    isLocked
                      ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/50 text-rose-900 dark:text-rose-400 cursor-not-allowed'
                      : 'bg-slate-50/50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                  placeholder="Masukkan username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={MAX_USERNAME_LEN}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex justify-between items-end px-1">
                <label htmlFor="login-password" className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                  Kata Sandi
                </label>
                {isLocked && (
                  <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 bg-rose-100 dark:bg-rose-500/20 px-2 py-0.5 rounded-full animate-pulse">
                    <Clock className="w-3.5 h-3.5" /> {fmtTime(timeLeft)}
                  </span>
                )}
              </div>
              <div className="relative">
                <div className={`absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors ${state.pin ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}`}>
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  id="login-password"
                  type={showPin ? 'text' : 'password'}
                  value={state.pin}
                  disabled={isLocked || isAuthing}
                  onChange={e => dispatch({ type: 'SET_PIN', payload: e.target.value })}
                  className={`block w-full pl-12 pr-12 py-3.5 rounded-2xl font-mono text-base tracking-[0.2em] font-medium transition-all duration-300 border ${
                    isLocked
                      ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/50 text-rose-900 dark:text-rose-400 cursor-not-allowed'
                      : 'bg-slate-50/50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                  placeholder={isLocked ? 'TERKUNCI' : '••••••••'}
                  autoComplete="current-password"
                  maxLength={MAX_PASSWORD_LEN}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    disabled={isLocked || isAuthing}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all disabled:opacity-30"
                    aria-label={showPin ? 'Sembunyikan password' : 'Tampilkan password'}
                  >
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className={`w-full flex justify-center items-center gap-2 py-4 px-6 rounded-2xl text-base font-bold text-white transition-all duration-300 disabled:cursor-not-allowed mt-2 ${
                isAuthing   ? 'bg-blue-600'
                : isLocked  ? 'bg-slate-800 text-slate-400'
                : !canSubmit ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98] shadow-lg shadow-blue-600/20 group'
              }`}
              aria-busy={isAuthing}
            >
              {isAuthing ? (
                <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Memverifikasi...</span></>
              ) : isLocked ? (
                <><Lock className="w-5 h-5" /><span>Akses Tertutup</span></>
              ) : (
                <><span>Masuk ke Sistem</span><LogIn className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" /></>
              )}
            </button>

          </form>
        </div>
      </div>
    </div>
  );
}
