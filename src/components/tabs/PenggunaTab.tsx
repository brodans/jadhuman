import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Plus, Trash2, Edit3, Save, X, Eye, EyeOff,
  CheckCircle, CheckCircle2, AlertCircle, Loader2, User, RefreshCw, KeyRound,
  CreditCard, ToggleLeft, ToggleRight, RotateCcw, Clock, ShieldCheck, Search,
} from 'lucide-react';
import {
  fetchAllUsers, createUserAccount, updateUserAccount, deleteUserAccount,
  DEFAULT_USER_PERMISSIONS, PERMISSION_GROUPS, TAB_PERMISSION_LABELS,
  type UserAccountSafe, type TabPermissions
} from '../../lib/userManager';
import {
  getSubscription, createOrUpdateSubscription, manualActivateSubscription, getAllSubscriptions, formatRp,
  type UserSubscription, type BillingType,
} from '../../lib/subscription';

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
  const toggle = (key: keyof TabPermissions) => {
    if (LOCKED_ON_KEYS.includes(key)) return; // tabLogin dikunci ON
    onChange({ ...perms, [key]: !perms[key] });
  };

  const isAllSelected = allOn(perms);

  return (
    <div className="space-y-4">
      {/* Header Select All */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700/60">
        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Hak Akses Tab Menu
        </label>
        <button
          type="button"
          onClick={() => onChange(toggleAll(perms, !isAllSelected))}
          className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
        >
          {isAllSelected ? 'Hapus Semua' : 'Pilih Semua'}
        </button>
      </div>

      {/* Permission groups */}
      <div className="space-y-3">
        {PERMISSION_GROUPS.map(group => (
          <div key={group.label} className="space-y-1.5">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              {group.label}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {group.keys.map(key => {
                const checked = Boolean(perms[key]);
                const isLocked = LOCKED_ON_KEYS.includes(key);
                return (
                  <label
                    key={key}
                    onClick={() => toggle(key)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
                      checked
                        ? 'bg-blue-50/80 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/50 text-blue-900 dark:text-blue-200 font-semibold'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    } ${isLocked ? 'opacity-90' : ''}`}
                  >
                    <span>{TAB_PERMISSION_LABELS[key]}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isLocked}
                      onChange={() => {}} // handled by parent div
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-komponen: Status badge subscription ──────────────────────────────────
function SubStatusBadge({ sub }: { sub: UserSubscription | null }) {
  if (!sub) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
      Belum diatur
    </span>
  );
  if (sub.payment_enabled === false) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
      <ShieldCheck className="w-3 h-3 text-slate-500 dark:text-slate-400" /> Payment Off (Bypass)
    </span>
  );
  if (sub.status === 'active') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50">
      <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Lunas / Aktif
    </span>
  );
  if (sub.status === 'expired') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700/50">
      <Clock className="w-3 h-3 text-rose-500" /> Kedaluwarsa
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50">
      <AlertCircle className="w-3 h-3 text-amber-500" /> Belum Bayar
    </span>
  );
}

// ─── Sub-komponen: Baris pengaturan payment per akun ─────────────────────────
function PaymentRow({ user, onSaved }: { user: UserAccountSafe; onSaved: () => void }) {
  const [sub, setSub]               = useState<UserSubscription | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [amount, setAmount]         = useState(50000);
  const [billingType, setBillingType] = useState<BillingType>('monthly');
  const [enabled, setEnabled]       = useState(true);
  const [msg, setMsg]               = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const s = await getSubscription(user.id);
      if (cancelled) return;
      setSub(s);
      setAmount(s?.amount ?? 50000);
      setBillingType(s?.billing_type ?? 'monthly');
      setEnabled(s?.payment_enabled ?? true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  const isDirty =
    amount     !== (sub?.amount ?? 50000)         ||
    billingType !== (sub?.billing_type ?? 'monthly') ||
    enabled     !== (sub?.payment_enabled ?? true);

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      await createOrUpdateSubscription(user.id, {
        amount, billing_type: billingType, payment_enabled: enabled,
      });
      const fresh = await getSubscription(user.id);
      setSub(fresh);
      setMsg('✅ Settings tersimpan');
      onSaved();
    } catch {
      setMsg('❌ Gagal menyimpan');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  };

  const handleManualActivate = async () => {
    setSaving(true);
    setMsg('');
    try {
      await manualActivateSubscription(user.id, billingType);
      const fresh = await getSubscription(user.id);
      setSub(fresh);
      setMsg('✅ Diaktifkan (Sudah Bayar)');
      onSaved();
    } catch {
      setMsg('❌ Gagal mengaktifkan');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setMsg('');
    try {
      await createOrUpdateSubscription(user.id, { status: 'unpaid', paid_at: null, expires_at: null });
      const fresh = await getSubscription(user.id);
      setSub(fresh);
      setMsg('🔄 Status direset ke Belum Bayar');
      onSaved();
    } catch {
      setMsg('❌ Gagal reset');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-2 py-3 px-4 text-xs text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> Memuat data langganan @{user.username}...
    </div>
  );

  const paidAtFormatted = sub?.paid_at ? new Date(
    (sub.paid_at as any)?.seconds ? (sub.paid_at as any).seconds * 1000 : sub.paid_at as any
  ).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  const expiresAtFormatted = sub?.expires_at ? new Date(
    (sub.expires_at as any)?.seconds ? (sub.expires_at as any).seconds * 1000 : sub.expires_at as any
  ).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 space-y-3.5 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-all">
      {/* Header baris */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/50 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs shrink-0">
            @
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate block">
              {user.username}
            </span>
          </div>
          <SubStatusBadge sub={sub} />
        </div>
        {msg && (
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-700/40">{msg}</span>
        )}
      </div>

      {/* Form Biaya & Billing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Nominal Tagihan */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-1 uppercase tracking-wider">
            Nominal Tagihan (Rp)
          </label>
          <input
            type="number"
            min={0}
            step={5000}
            value={amount}
            onChange={e => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full text-xs font-bold px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/40 text-slate-800 dark:text-white"
          />
          <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 mt-1">{formatRp(amount)}</p>
        </div>

        {/* Tipe Billing */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-1 uppercase tracking-wider">
            Siklus Billing
          </label>
          <select
            value={billingType}
            onChange={e => setBillingType(e.target.value as BillingType)}
            className="w-full text-xs font-bold px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/40 text-slate-800 dark:text-white"
          >
            <option value="monthly">Bulanan (Per 30 Hari)</option>
            <option value="one_time">Sekali Bayar (Permanen)</option>
          </select>
        </div>
      </div>

      {/* Info Tanggal Pembayaran & Expired */}
      {(paidAtFormatted || expiresAtFormatted) && (
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
          {paidAtFormatted && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Tgl Bayar: <strong className="text-slate-700 dark:text-slate-200">{paidAtFormatted}</strong>
            </span>
          )}
          {expiresAtFormatted && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              Masa Aktif s/d: <strong className="text-slate-700 dark:text-slate-200">{expiresAtFormatted}</strong>
            </span>
          )}
        </div>
      )}

      {/* Toggle payment status + Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => setEnabled(v => !v)}
          className={`flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-xl border transition-all ${
            enabled
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-300'
              : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
          }`}
        >
          {enabled
            ? <><ToggleRight className="w-4 h-4 text-emerald-500" /> Fitur Payment Wajib (ON)</>
            : <><ToggleLeft className="w-4 h-4 text-slate-400" /> Payment Off (Bypass Login)</>
          }
        </button>

        <div className="flex flex-wrap gap-2">
          {/* Simpan Biaya */}
          {isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Simpan Biaya
            </button>
          )}

          {/* Aktifkan Manual */}
          {sub?.status !== 'active' && (
            <button
              type="button"
              onClick={handleManualActivate}
              disabled={saving}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-all disabled:opacity-40 shadow-sm"
              title="Tandai akun ini sudah bayar (misal cash/transfer)"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Aktifkan (Sudah Bayar)
            </button>
          )}

          {/* Reset ke Belum Bayar */}
          {sub?.status === 'active' && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 transition-all disabled:opacity-40"
              title="Reset status akun menjadi Belum Bayar"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Reset ke Belum Bayar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PenggunaTab() {
  const [users, setUsers] = useState<UserAccountSafe[]>([]);
  const [subsMap, setSubsMap] = useState<Record<string, UserSubscription>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState<'users' | 'payment'>('users');
  const [successMsg, setSuccessMsg] = useState('');

  const [mode, setMode] = useState<FormMode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm());
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Search & Filter state untuk Tab Payment
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'unpaid' | 'expired' | 'bypass'>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userList, subsData] = await Promise.all([
        fetchAllUsers(),
        getAllSubscriptions(),
      ]);
      setUsers(userList.sort((a, b) => a.username.localeCompare(b.username)));
      setSubsMap(subsData);
    } catch (e: any) {
      setError(e.message || 'Gagal memuat data pengguna & pembayaran.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Ringkasan Statistik Pembayaran
  const paymentStats = useMemo(() => {
    let active = 0;
    let unpaid = 0;
    let expired = 0;
    let bypass = 0;
    let totalRevenue = 0;

    users.forEach(u => {
      const sub = subsMap[u.id];
      if (!sub || sub.payment_enabled === false) {
        bypass++;
      } else if (sub.status === 'active') {
        active++;
        totalRevenue += (sub.amount || 50000);
      } else if (sub.status === 'expired') {
        expired++;
      } else {
        unpaid++;
      }
    });

    return {
      total: users.length,
      active,
      unpaid,
      expired,
      bypass,
      totalRevenue,
    };
  }, [users, subsMap]);

  // Filtered users untuk Payment Tab
  const filteredPaymentUsers = useMemo(() => {
    return users.filter(u => {
      // Filter username
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        if (!u.username.toLowerCase().includes(query)) return false;
      }

      // Filter status
      const sub = subsMap[u.id];
      if (filterStatus === 'all') return true;
      if (filterStatus === 'bypass') return !sub || sub.payment_enabled === false;
      if (filterStatus === 'active') return sub && sub.payment_enabled !== false && sub.status === 'active';
      if (filterStatus === 'expired') return sub && sub.payment_enabled !== false && sub.status === 'expired';
      if (filterStatus === 'unpaid') return sub && sub.payment_enabled !== false && sub.status === 'unpaid';

      return true;
    });
  }, [users, subsMap, searchQuery, filterStatus]);

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
      await loadData();
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
      await loadData();
    } catch (e: any) {
      flash(e.message || 'Gagal menghapus.', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* ── Tab Switcher ── */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-2xl">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-xl transition-all ${
            activeTab === 'users'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" /> Kelola Pengguna
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('payment')}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-xl transition-all ${
            activeTab === 'payment'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" /> Langganan & Fitur Bayar
        </button>
      </div>

      {/* ══ TAB: KELOLA PENGGUNA ══ */}
      {activeTab === 'users' && <>

      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Manajemen Pengguna</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
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

      </> /* end activeTab === 'users' */}

      {/* ══ TAB: LANGGANAN & PEMBAYARAN ══ */}
      {activeTab === 'payment' && (
        <div className="space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Pengaturan & Monitor Pembayaran Akun
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Kelola status lunas, nominal tagihan, dan toggle akses pembayaran per akun pengguna.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Dashboard Ringkasan Statistik */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <div className="bg-white dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700/60 space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Akun</p>
              <p className="text-lg font-extrabold text-slate-800 dark:text-white">{paymentStats.total}</p>
            </div>
            <div className="bg-emerald-50/60 dark:bg-emerald-900/20 p-3 rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 space-y-1">
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Sudah Bayar (Aktif)</p>
              <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">{paymentStats.active}</p>
            </div>
            <div className="bg-amber-50/60 dark:bg-amber-900/20 p-3 rounded-2xl border border-amber-200/60 dark:border-amber-800/40 space-y-1">
              <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Belum Bayar</p>
              <p className="text-lg font-extrabold text-amber-700 dark:text-amber-300">{paymentStats.unpaid}</p>
            </div>
            <div className="bg-rose-50/60 dark:bg-rose-900/20 p-3 rounded-2xl border border-rose-200/60 dark:border-rose-800/40 space-y-1">
              <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">Kedaluwarsa</p>
              <p className="text-lg font-extrabold text-rose-700 dark:text-rose-300">{paymentStats.expired}</p>
            </div>
            <div className="bg-slate-100/80 dark:bg-slate-800/80 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1 col-span-2 sm:col-span-1">
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Payment Off (Bypass)</p>
              <p className="text-lg font-extrabold text-slate-700 dark:text-slate-200">{paymentStats.bypass}</p>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Input Cari Username */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari username akun..."
                className="w-full pl-9 pr-3 py-2 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/40 text-slate-800 dark:text-slate-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Selector Filter Status */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
              {[
                { key: 'all', label: `Semua (${users.length})` },
                { key: 'active', label: `Sudah Bayar (${paymentStats.active})` },
                { key: 'unpaid', label: `Belum Bayar (${paymentStats.unpaid})` },
                { key: 'expired', label: `Kedaluwarsa (${paymentStats.expired})` },
                { key: 'bypass', label: `Bypass (${paymentStats.bypass})` },
              ].map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilterStatus(item.key as any)}
                  className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                    filterStatus === item.key
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* User List */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span>Memuat data pengguna dan status pembayaran...</span>
            </div>
          )}

          {!loading && filteredPaymentUsers.length === 0 && (
            <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 space-y-2 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              <CreditCard className="w-8 h-8 mx-auto opacity-30" />
              <p className="font-semibold">Tidak ada akun yang sesuai filter.</p>
            </div>
          )}

          {!loading && filteredPaymentUsers.map(u => (
            <PaymentRow key={u.id} user={u} onSaved={loadData} />
          ))}

        </div>
      )}

    </div>
  );
}
