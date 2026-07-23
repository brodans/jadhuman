import { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Trash2, Edit3, Save, X, Eye, EyeOff,
  CheckCircle, AlertCircle, Loader2, User, RefreshCw, KeyRound
} from 'lucide-react';
import {
  fetchAllUsers, createUserAccount, updateUserAccount, deleteUserAccount,
  DEFAULT_USER_PERMISSIONS, PERMISSION_GROUPS, TAB_PERMISSION_LABELS,
  type UserAccountSafe, type TabPermissions
} from '../../lib/userManager';

type FormMode = 'idle' | 'create' | 'edit';

interface UserForm {
  username: string;
  password: string;
  confirmPassword: string;
  permissions: TabPermissions;
}

const emptyForm = (): UserForm => ({
  username: '',
  password: '',
  confirmPassword: '',
  permissions: { ...DEFAULT_USER_PERMISSIONS },
});

// ─── Helper: toggle semua permission (tabLogin selalu ON, tidak bisa dimatikan) ───
const LOCKED_ON_KEYS: (keyof TabPermissions)[] = ['tabLogin'];

const allOn = (perms: TabPermissions): boolean =>
  Object.entries(perms).every(([k, v]) => LOCKED_ON_KEYS.includes(k as keyof TabPermissions) ? true : Boolean(v));

const toggleAll = (perms: TabPermissions, on: boolean): TabPermissions =>
  Object.fromEntries(
    Object.keys(perms).map(k => [
      k,
      LOCKED_ON_KEYS.includes(k as keyof TabPermissions) ? true : on  // tabLogin selalu true
    ])
  ) as unknown as TabPermissions;

// ─── Sub-komponen: PermissionGrid dengan section grouping ────────
function PermissionGrid({
  perms,
  onChange,
}: {
  perms: TabPermissions;
  onChange: (p: TabPermissions) => void;
}) {
  const allEnabled = allOn(perms);

  return (
    <div className="space-y-3">
      {/* Toggle All */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Hak Akses Menu & Fitur
        </span>
        <button
          type="button"
          onClick={() => onChange(toggleAll(perms, !allEnabled))}
          className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors ${
            allEnabled
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          {allEnabled ? '✓ Nonaktifkan Semua' : 'Aktifkan Semua'}
        </button>
      </div>

      {/* Grouped sections */}
      {PERMISSION_GROUPS.map(group => (
        <div key={group.label} className="space-y-1.5">
          <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest pt-1">
            {group.label}
          </h4>
          <div className="grid grid-cols-1 gap-1">
            {group.keys.map(key => {
              const isLocked = LOCKED_ON_KEYS.includes(key);
              return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (isLocked) return; // tidak bisa di-toggle
                  onChange({ ...perms, [key]: !perms[key] });
                }}
                className={`flex items-center justify-between w-full px-3 py-2 rounded-xl border text-left transition-all ${
                  isLocked
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-400 cursor-not-allowed opacity-80'
                    : perms[key]
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
              >
                <span className="text-xs font-semibold leading-tight flex items-center gap-1.5">
                  {isLocked && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500 dark:text-blue-400">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  )}
                  {TAB_PERMISSION_LABELS[key]}
                </span>
                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  isLocked
                    ? 'bg-blue-200 dark:bg-blue-800/60 text-blue-700 dark:text-blue-300'
                    : perms[key]
                      ? 'bg-emerald-200 dark:bg-emerald-800/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                }`}>
                  {isLocked ? 'WAJIB' : perms[key] ? 'ON' : 'OFF'}
                </span>
              </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Komponen utama ───────────────────────────────────────────────
export default function PenggunaTab() {
  const [users, setUsers] = useState<UserAccountSafe[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [mode, setMode] = useState<FormMode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm());
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await fetchAllUsers();
      setUsers(list.sort((a, b) => a.username.localeCompare(b.username)));
    } catch (e: any) {
      setError(e.message || 'Gagal memuat daftar pengguna.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const flash = (msg: string, isError = false) => {
    if (isError) { setError(msg); setSuccessMsg(''); }
    else { setSuccessMsg(msg); setError(''); }
    setTimeout(() => { setError(''); setSuccessMsg(''); }, 4000);
  };

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setMode('create');
    setError('');
  };

  const openEdit = (u: UserAccountSafe) => {
    setForm({
      username: u.username,
      password: '',
      confirmPassword: '',
      permissions: { ...u.permissions },
    });
    setEditingId(u.id);
    setMode('edit');
    setError('');
  };

  const closeForm = () => {
    setMode('idle');
    setEditingId(null);
    setForm(emptyForm());
    setError('');
  };

  const validate = (): string | null => {
    if (!form.username.trim()) return 'Username wajib diisi.';
    if (!/^[a-z0-9_.-]+$/i.test(form.username)) return 'Username hanya boleh huruf, angka, _ . -';
    if (mode === 'create') {
      if (!form.password) return 'Password wajib diisi.';
      if (form.password.length < 4) return 'Password minimal 4 karakter.';
      if (form.password !== form.confirmPassword) return 'Konfirmasi password tidak cocok.';
    }
    if (mode === 'edit' && form.password) {
      if (form.password.length < 4) return 'Password minimal 4 karakter.';
      if (form.password !== form.confirmPassword) return 'Konfirmasi password tidak cocok.';
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }

    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        await createUserAccount(form.username.trim().toLowerCase(), form.password, '', form.permissions);
        flash(`Akun "${form.username}" berhasil dibuat.`);
      } else if (mode === 'edit' && editingId) {
        await updateUserAccount(editingId, {
          username: form.username.trim().toLowerCase(),
          password: form.password || undefined,
          permissions: form.permissions,
        });
        flash(`Akun "${form.username}" berhasil diperbarui.`);
      }
      closeForm();
      await loadUsers();
    } catch (e: any) {
      setError(e.message || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      await deleteUserAccount(id);
      flash('Akun berhasil dihapus.');
      setConfirmDelete(null);
      await loadUsers();
    } catch (e: any) {
      flash(e.message || 'Gagal menghapus.', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Manajemen Pengguna</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {mode === 'idle' && (
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> Tambah Pengguna
            </button>
          )}
        </div>
      </div>

      {/* Notifikasi */}
      {error && (
        <div className="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-start gap-2.5 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ── FORM TAMBAH/EDIT ── */}
      {(mode === 'create' || mode === 'edit') && (
        <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
              {mode === 'create'
                ? <><Plus className="w-4 h-4 text-blue-500" /> Tambah Pengguna Baru</>
                : <><Edit3 className="w-4 h-4 text-amber-500" /> Edit Pengguna</>}
            </h4>
            <button type="button" onClick={closeForm} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }))}
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                placeholder="contoh: budi_santoso"
                autoCapitalize="none"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
              Password {mode === 'edit' && <span className="normal-case font-normal text-slate-400 dark:text-slate-500">(kosongkan jika tidak diubah)</span>}
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                placeholder="Min. 4 karakter"
              />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Konfirmasi Password */}
          {(mode === 'create' || form.password) && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Konfirmasi Password</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  placeholder="Ulangi password"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Permission Grid */}
          <div className="border-t border-slate-200 dark:border-slate-700/60 pt-4">
            <PermissionGrid perms={form.permissions} onChange={p => setForm(f => ({ ...f, permissions: p }))} />
          </div>

          {/* Aksi */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="px-4 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* ── DAFTAR USER ── */}
      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-slate-400 dark:text-slate-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          Memuat pengguna...
        </div>
      ) : users.length === 0 && mode === 'idle' ? (
        <div className="py-10 text-center text-slate-400 dark:text-slate-600 text-sm flex flex-col items-center gap-3">
          <Users className="w-10 h-10 opacity-30" />
          <div>
            <p className="font-semibold">Belum ada pengguna</p>
            <p className="text-xs mt-1">Klik "Tambah Pengguna" untuk membuat akun baru</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div
              key={u.id}
              className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <User className="w-4.5 h-4.5 text-blue-500 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">@{u.username}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(Object.keys(TAB_PERMISSION_LABELS) as (keyof TabPermissions)[])
                    .filter(k => u.permissions[k])
                    .slice(0, 3)
                    .map(k => (
                      <span key={k} className="text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                        {TAB_PERMISSION_LABELS[k]}
                      </span>
                    ))}
                  {(Object.keys(u.permissions) as (keyof TabPermissions)[]).filter(k => u.permissions[k]).length > 3 && (
                    <span className="text-[9px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full">
                      +{(Object.keys(u.permissions) as (keyof TabPermissions)[]).filter(k => u.permissions[k]).length - 3}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(u)}
                  className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  title="Edit"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                {confirmDelete === u.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(u.id)}
                      disabled={saving}
                      className="text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {saving ? '...' : 'Hapus'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-lg transition-colors"
                    >
                      Batal
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(u.id)}
                    className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Hapus"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {users.length > 0 && (
        <p className="text-[10px] text-slate-400 dark:text-slate-600 text-center pt-1">
          {users.length} akun pengguna aktif · Data disimpan di Firebase
        </p>
      )}
    </div>
  );
}
