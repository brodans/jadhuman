import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X, Lock, Save, AlertCircle, Eye, EyeOff,
  ChevronDown, ChevronUp, Users, Settings, AtSign, Loader2,
  Bell
} from 'lucide-react';
import { hashPinLayered, verifyPinLayered, encryptAppCredential, decryptAppCredential } from '../lib/encryption';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAppContext } from '../context/AppContext';
import { useBackButton } from '../hooks/useBackButton';
import { updateUserAccount, validatePassword, verifyUserPassword } from '../lib/userManager';
import PenggunaTab from './tabs/PenggunaTab';
import TabNotifikasi from './tabs/TabNotifikasi';

interface PinChangeModalProps {
  onClose: () => void;
}

type ModalTab = 'pengaturan' | 'notifikasi' | 'pengguna';
type CredSection = 'none' | 'username' | 'password';

// ─── Validation helpers ───────────────────────────────────────────
const ADMIN_USERNAME_REGEX = /^[a-zA-Z0-9_.-]{2,32}$/;

function validateAdminUsername(u: string): string {
  const trimmed = u.trim();
  if (!trimmed) throw new Error('Username tidak boleh kosong.');
  if (trimmed.length < 2 || trimmed.length > 32) throw new Error('Username harus 2–32 karakter.');
  if (!ADMIN_USERNAME_REGEX.test(trimmed)) throw new Error('Username hanya boleh huruf, angka, _ . -');
  return trimmed.toLowerCase();
}

// ─── Verify admin password against Firebase ───────────────────────
async function verifyAdminPassword(password: string): Promise<boolean> {
  const authRef = doc(db, 'settings', 'auth');
  const authSnap = await getDoc(authRef);
  // Jika settings/auth belum ada, tidak ada credential yang bisa diverifikasi
  // Admin harus setup via Firebase Console terlebih dahulu
  if (!authSnap.exists()) return false;

  const data = authSnap.data();
  if (data.pinEncrypted) {
    try {
      const dec = decryptAppCredential(data.pinEncrypted);
      if (dec && dec === password) return true;
    } catch { /* ignore */ }
  }
  if (data.pinHash && verifyPinLayered(password, data.pinHash)) return true;
  return false;
}

export default function PinChangeModal({ onClose }: PinChangeModalProps) {
  const { developerMode, setDeveloperMode, datePickerStyle, setDatePickerStyle, userRole, currentUser, tabPermissions } = useAppContext();
  const canSeeNotifikasi = userRole === 'admin' || (tabPermissions?.tabNotifikasi ?? true);

  const [activeTab, setActiveTab] = useState<ModalTab>('pengaturan');
  const [openSection, setOpenSection] = useState<CredSection>('none');

  useBackButton(() => {
    if (openSection !== 'none') { setOpenSection('none'); return true; }
    return false;
  }, openSection !== 'none');

  // ── State: ganti username admin ───────────────────────────────
  const [currentAdminUsername, setCurrentAdminUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [verifyPassForUsername, setVerifyPassForUsername] = useState('');
  const [showVerifyPass, setShowVerifyPass] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  // ── State: ganti password ─────────────────────────────────────
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showOldPin, setShowOldPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [passError, setPassError] = useState('');
  const [passSuccess, setPassSuccess] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  // Reset form saat section ditutup
  useEffect(() => {
    if (openSection !== 'username') {
      setNewUsername(''); setVerifyPassForUsername(''); setUsernameError(''); setUsernameSuccess('');
    }
    if (openSection !== 'password') {
      setOldPin(''); setNewPin(''); setConfirmPin(''); setPassError(''); setPassSuccess('');
    }
  }, [openSection]);

  // Load current admin username dari Firebase
  useEffect(() => {
    if (userRole !== 'admin') return;
    getDoc(doc(db, 'settings', 'auth')).then(snap => {
      if (snap.exists()) {
        setCurrentAdminUsername(snap.data().adminUsername || 'admin');
      } else {
        setCurrentAdminUsername('admin');
      }
    }).catch(() => setCurrentAdminUsername('admin'));
  }, [userRole]);

  // ── Handler: simpan username baru (admin) ─────────────────────
  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(''); setUsernameSuccess('');

    let validated: string;
    try { validated = validateAdminUsername(newUsername); }
    catch (err: any) { setUsernameError(err.message); return; }

    if (!verifyPassForUsername) { setUsernameError('Konfirmasi password diperlukan.'); return; }

    setSavingUsername(true);
    try {
      const passOk = await verifyAdminPassword(verifyPassForUsername.substring(0, 128));
      if (!passOk) { setUsernameError('Password salah. Username tidak diubah.'); return; }

      const authRef = doc(db, 'settings', 'auth');
      await setDoc(authRef, {
        adminUsername: validated,
        updatedAt: Date.now(),
      }, { merge: true });

      setCurrentAdminUsername(validated);
      setUsernameSuccess(`Username berhasil diubah menjadi "${validated}".`);
      setNewUsername('');
      setVerifyPassForUsername('');
    } catch (err: any) {
      setUsernameError(err.message || 'Gagal menyimpan username.');
    } finally {
      setSavingUsername(false);
    }
  };

  // ── Handler: simpan password ──────────────────────────────────
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(''); setPassSuccess('');

    const oldTrimmed = oldPin.substring(0, 128);
    const newTrimmed = newPin.substring(0, 128);
    const confirmTrimmed = confirmPin.substring(0, 128);

    if (!oldTrimmed || !newTrimmed || !confirmTrimmed) { setPassError('Semua kolom harus diisi.'); return; }
    if (newTrimmed !== confirmTrimmed) { setPassError('Password baru dan konfirmasi tidak cocok.'); return; }

    try { validatePassword(newTrimmed, 'Password baru'); }
    catch (err: any) { setPassError(err.message); return; }

    setSavingPass(true);
    try {
      if (userRole === 'admin') {
        // ── Ubah password admin (Firebase settings/auth) ──────────
        const passOk = await verifyAdminPassword(oldTrimmed);
        if (!passOk) { setPassError('Password lama tidak valid.'); return; }

        const newHash = hashPinLayered(newTrimmed);
        const encryptedPin = encryptAppCredential(newTrimmed);
        await setDoc(doc(db, 'settings', 'auth'), {
          pinHash: newHash,
          pinEncrypted: encryptedPin,
          updatedAt: Date.now(),
        }, { merge: true });

        setPassSuccess('Password berhasil diperbarui!');
        setTimeout(() => onClose(), 2000);

      } else if (currentUser) {
        // ── Ubah password user (Firestore jadhuman_users) ─────────
        // Verifikasi password lama
        const valid = await verifyUserPassword(currentUser.username, oldTrimmed);
        if (!valid) { setPassError('Password lama tidak valid.'); return; }

        await updateUserAccount(currentUser.id, { password: newTrimmed });
        setPassSuccess('Password berhasil diperbarui!');
        setTimeout(() => onClose(), 2000);
      }
    } catch (err: any) {
      setPassError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setSavingPass(false);
    }
  };

  // ── Shared input classes ──────────────────────────────────────
  const inputCls = `w-full pl-4 pr-12 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none text-sm transition-all`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            Pengaturan Jadhuman
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-slate-100 dark:border-slate-700 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('pengaturan')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold transition-colors border-b-2 ${activeTab === 'pengaturan' ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            <Settings className="w-3.5 h-3.5" /> Pengaturan
          </button>
          {canSeeNotifikasi && (
            <button
              type="button"
              onClick={() => setActiveTab('notifikasi')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold transition-colors border-b-2 ${activeTab === 'notifikasi' ? 'border-violet-500 text-violet-600 dark:text-violet-400 bg-violet-50/50 dark:bg-violet-900/10' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
            >
              <Bell className="w-3.5 h-3.5" /> Notifikasi
            </button>
          )}
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={() => setActiveTab('pengguna')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold transition-colors border-b-2 ${activeTab === 'pengguna' ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
            >
              <Users className="w-3.5 h-3.5" /> Pengguna
            </button>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 custom-scrollbar">

          {/* ═══ TAB PENGATURAN ═══ */}
          {activeTab === 'pengaturan' && (
            <div className="p-5 space-y-4">

              {/* Mode Developer */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-700/60 rounded-2xl flex items-center justify-between shadow-sm">
                <div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">⚙️ Mode Developer</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 block mt-0.5">Aktifkan request &amp; respon JSON</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDeveloperMode(!developerMode)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${developerMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${developerMode ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Gaya Kalender */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-700/60 rounded-2xl space-y-3 shadow-sm">
                <div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">📅 Gaya Pemilih Tanggal</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 block mt-0.5">Pilih tampilan kalender di aplikasi</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['modern', 'klasik'] as const).map(style => (
                    <button key={style} type="button" onClick={() => setDatePickerStyle(style)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border ${datePickerStyle === style ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      {style === 'modern' ? 'Kalender Modern' : 'Klasik Dropdown'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Akun Saya — collapse sections ── */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 bg-slate-50/80 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-700/60">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                    {userRole === 'admin' ? '🔑 Akun Administrator' : '🔑 Akun Saya'}
                  </p>
                  {userRole === 'admin' && currentAdminUsername && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      Username saat ini: <span className="font-bold text-slate-700 dark:text-slate-300">@{currentAdminUsername}</span>
                    </p>
                  )}
                </div>

                {/* Ganti Username — hanya admin */}
                {userRole === 'admin' && (
                  <div className="border-b border-slate-100 dark:border-slate-700/60">
                    <button
                      type="button"
                      onClick={() => setOpenSection(openSection === 'username' ? 'none' : 'username')}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <AtSign className="w-4 h-4 text-blue-500" />
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Ganti Username</span>
                      </div>
                      {openSection === 'username'
                        ? <ChevronUp className="w-4 h-4 text-slate-400" />
                        : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>

                    {openSection === 'username' && (
                      <form onSubmit={handleSaveUsername} className="px-5 pb-5 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                        {/* Username baru */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Username Baru</label>
                          <div className="relative">
                            <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                            <input
                              type="text"
                              value={newUsername}
                              onChange={e => setNewUsername(e.target.value.toLowerCase().replace(/\s/g, '').substring(0, 32))}
                              className="w-full pl-9 pr-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none text-sm transition-all"
                              placeholder="username baru (huruf kecil)"
                              autoCapitalize="none"
                              maxLength={32}
                            />
                          </div>
                        </div>
                        {/* Konfirmasi password */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Konfirmasi Password</label>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                            <input
                              type={showVerifyPass ? 'text' : 'password'}
                              value={verifyPassForUsername}
                              onChange={e => setVerifyPassForUsername(e.target.value.substring(0, 128))}
                              className={`${inputCls} pl-9`}
                              placeholder="Masukkan password untuk verifikasi"
                              maxLength={128}
                            />
                            <button type="button" onClick={() => setShowVerifyPass(!showVerifyPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                              {showVerifyPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {usernameError && (
                          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-xl text-xs font-semibold">
                            <AlertCircle className="w-4 h-4 shrink-0" /><span>{usernameError}</span>
                          </div>
                        )}
                        {usernameSuccess && (
                          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl text-xs font-semibold">
                            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span>{usernameSuccess}</span>
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={savingUsername}
                          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-colors shadow-sm"
                        >
                          {savingUsername ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          {savingUsername ? 'Menyimpan...' : 'Simpan Username'}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {/* Ganti Password */}
                <div>
                  <button
                    type="button"
                    onClick={() => setOpenSection(openSection === 'password' ? 'none' : 'password')}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <Lock className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Ganti Password</span>
                    </div>
                    {openSection === 'password'
                      ? <ChevronUp className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>

                  {openSection === 'password' && (
                    <form onSubmit={handleSavePassword} className="px-5 pb-5 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                      {[
                        { label: 'Password Lama', val: oldPin, set: setOldPin, show: showOldPin, toggle: () => setShowOldPin(!showOldPin) },
                        { label: 'Password Baru', val: newPin, set: setNewPin, show: showNewPin, toggle: () => setShowNewPin(!showNewPin) },
                        { label: 'Konfirmasi Password Baru', val: confirmPin, set: setConfirmPin, show: showConfirmPin, toggle: () => setShowConfirmPin(!showConfirmPin) },
                      ].map(({ label, val, set, show, toggle }) => (
                        <div key={label}>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">{label}</label>
                          <div className="relative">
                            <input
                              type={show ? 'text' : 'password'}
                              value={val}
                              onChange={e => set(e.target.value)}
                              className={inputCls}
                              placeholder={label === 'Password Lama' ? 'Masukkan password lama' : 'Min. 4 karakter'}
                              maxLength={128}
                            />
                            <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      ))}

                      {passError && (
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-xl text-xs font-semibold">
                          <AlertCircle className="w-4 h-4 shrink-0" /><span>{passError}</span>
                        </div>
                      )}
                      {passSuccess && (
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl text-xs font-semibold">
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <span>{passSuccess}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={savingPass}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-colors shadow-sm"
                      >
                        {savingPass ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {savingPass ? 'Menyimpan...' : 'Simpan Password'}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Close */}
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 px-4 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-bold transition-colors"
              >
                Tutup
              </button>
            </div>
          )}

          {/* ═══ TAB NOTIFIKASI ═══ */}
          {canSeeNotifikasi && activeTab === 'notifikasi' && (
            <div className="p-5">
              <TabNotifikasi />
            </div>
          )}

          {/* ═══ TAB PENGGUNA (admin only) ═══ */}
          {activeTab === 'pengguna' && userRole === 'admin' && (
            <div className="p-5">
              <PenggunaTab />
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
