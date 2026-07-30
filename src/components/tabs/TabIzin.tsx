import React, { useState, useEffect, useRef } from 'react';
import { FileCheck, Search, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { sendRequest } from '../../api';
import DatePicker from '../ui/DatePicker';
import DevLogSection from '../DevLogSection';
import { formatBeautifulDateTime, getTodayWIB, getTodayWIBWithOffset } from '../../lib/dateFormatter';
import ImageLightbox from '../ui/ImageLightbox';
import { useBackButton } from '../../hooks/useBackButton';
import { reportPegawaiList } from '../../data/database';

export default function TabIzin() {
  const { pegawai, config, developerMode, tabPermissions, userRole } = useAppContext();

  // Boleh cari pegawai lain jika admin atau permission allowSearchIzin aktif
  const canSearchIzin = userRole === 'admin' || tabPermissions.allowSearchIzin;

  // --- Pegawai Selection State ---
  const [selectedPegawai, setSelectedPegawai] = useState<any | null>(null);
  const [searchPegawai, setSearchPegawai] = useState('');
  const [showPegawaiDropdown, setShowPegawaiDropdown] = useState(false);
  const pegawaiDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pegawaiDropdownRef.current && !pegawaiDropdownRef.current.contains(event.target as Node)) {
        setShowPegawaiDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredPegawai = reportPegawaiList.filter((p: any) => 
    p.nama.toLowerCase().includes(searchPegawai.toLowerCase()) || 
    p.nip.toLowerCase().includes(searchPegawai.toLowerCase())
  );
  
  const [tglAwal, setTglAwal] = useState(getTodayWIBWithOffset(-3));
  const [tglAkhir, setTglAkhir] = useState(getTodayWIB());
  
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [modalImg, setModalImg] = useState<{src: string, title: string} | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [izinLog, setIzinLog] = useState<{ request: any; response: any } | null>(null);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (data && visibleCount < data.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  const fetchIzin = async () => {
    setLoading(true);
    setError('');
    setData(null);
    setIzinLog(null);
    setVisibleCount(50);
    // Jika tidak punya izin search, selalu gunakan id sendiri
    const effectivePegawai = canSearchIzin ? selectedPegawai : null;
    const targetIdPegawai = effectivePegawai ? effectivePegawai.id : config.idPegawai;
    const payload = {
      id_pegawai: targetIdPegawai,
      tgl_awal: tglAwal,
      tgl_akhir: tglAkhir
    };
    try {
      const res = await sendRequest("/izin/history_Izin", payload);
      setIzinLog({ request: payload, response: res });
      if (res && res.success && res.data && res.data.length > 0) {
        setData(res.data);
      } else {
        setError('History kosong.');
      }
    } catch (err: any) {
      setIzinLog({ request: payload, response: { error: err.message } });
      setError(`Network Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!pegawai) {
    return null; // App.tsx will auto-redirect to tabLogin
  }

  return (
    <div className="w-full mx-auto space-y-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <h3 className="text-lg font-bold text-slate-800 dark:text-white border-b-2 border-teal-500 pb-2 mb-4 flex items-center gap-2">
        <FileCheck className="w-5 h-5 text-teal-500" /> Tarik History Izin
      </h3>

      {/* Search Pegawai Section - hanya tampil jika punya izin */}
      {canSearchIzin ? (
      <div className={`mb-6 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 relative ${showPegawaiDropdown ? 'z-[60]' : 'z-30'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
              Cek History Izin / Cuti
            </span>
            <h4 className="text-sm font-bold text-slate-850 dark:text-slate-200 flex items-center gap-1.5">
              {selectedPegawai ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse inline-block" />
                  <span>Menelusuri Pegawai Lain</span>
                </>
              ) : (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  <span>Data Login Anda</span>
                </>
              )}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedPegawai 
                ? `Nama: ${selectedPegawai.nama} • NIP: ${selectedPegawai.nip}`
                : `Nama: ${pegawai.nama} • NIP: ${pegawai.nip}`
              }
            </p>
          </div>

          <div className="relative w-full md:w-80" ref={pegawaiDropdownRef}>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchPegawai}
                onChange={(e) => {
                  setSearchPegawai(e.target.value);
                  setShowPegawaiDropdown(true);
                }}
                onFocus={() => setShowPegawaiDropdown(true)}
                placeholder="Cari nama atau NIP pegawai..."
                className="w-full bg-white dark:bg-slate-800 text-slate-850 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-14 py-2 text-xs font-bold focus:outline-none focus:border-teal-500 shadow-sm"
              />
              {selectedPegawai && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPegawai(null);
                    setSearchPegawai('');
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-rose-500 hover:text-rose-600 font-bold text-[10px]"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Dropdown list */}
            {showPegawaiDropdown && (
              <div className="absolute right-0 left-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-[70] divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
                {filteredPegawai.length === 0 ? (
                  <div className="p-3 text-center text-slate-400 text-xs">
                    Pegawai tidak ditemukan.
                  </div>
                ) : (
                  filteredPegawai.slice(0, 10).map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedPegawai(p);
                        setSearchPegawai('');
                        setShowPegawaiDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                    >
                      <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">NIP: {p.nip} {p.nama_instansi ? `• ${p.nama_instansi}` : ''}</span>
                    </button>
                  ))
                )}
                {filteredPegawai.length > 10 && (
                  <div className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-center text-[9px] text-slate-400 font-medium">
                    Menampilkan 10 teratas. Gunakan pencarian lebih spesifik.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      ) : (
        /* Info banner: hanya menampilkan data sendiri */
        <div className="mb-6 p-3 bg-teal-50 dark:bg-teal-900/20 rounded-2xl border border-teal-200/60 dark:border-teal-700/50 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 inline-block" />
          <div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Data Login Anda</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{pegawai.nama} • NIP: {pegawai.nip}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DatePicker label="Tanggal Awal" value={tglAwal} onChange={setTglAwal} />
        <DatePicker label="Tanggal Akhir" value={tglAkhir} onChange={setTglAkhir} />
      </div>
      <button 
        onClick={fetchIzin}
        disabled={loading}
        className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-colors mt-6 flex items-center justify-center gap-2"
      >
        <Search className="w-5 h-5" /> {loading ? 'Menarik Data...' : 'Tarik History Izin'}
      </button>

      {error && (
        <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 font-medium text-sm rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {data && (
        <div 
          className="mt-6 p-4 bg-white dark:bg-slate-900/50 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800/80 text-sm rounded-xl overflow-x-auto max-h-[500px] custom-scrollbar shadow-sm"
          onScroll={handleScroll}
        >
          <div className="text-teal-600 dark:text-teal-400 font-bold mb-4 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> HISTORY IZIN & CUTI
          </div>
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] sm:text-sm">
              <tr>
                <th className="p-1.5 sm:p-3 font-semibold rounded-tl-lg whitespace-nowrap">Tanggal Pengajuan</th>
                <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Jenis Izin</th>
                <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Tanggal Pelaksanaan</th>
                <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Keterangan</th>
                <th className="p-1.5 sm:p-3 font-semibold rounded-tr-lg whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, visibleCount).map((item, i) => {
                let sts = (item.status || '').toUpperCase();
                let bcol = sts === 'DISETUJUI' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : sts === 'DITOLAK' ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400';
                
                return (
                  <tr key={i} className="border-b border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] sm:text-sm text-slate-700 dark:text-slate-300 transition-colors">
                    <td className="p-1.5 sm:p-3 align-top whitespace-nowrap">
                      {item.tgl_surat ? formatBeautifulDateTime(item.tgl_surat.split('T')[0]) : '-'}
                    </td>
                    <td className="p-1.5 sm:p-3 align-top min-w-[100px] sm:min-w-[120px] whitespace-normal">
                      <div className="font-bold text-blue-600 dark:text-blue-400 leading-tight">{item.cuti || '-'}</div>
                    </td>
                    <td className="p-1.5 sm:p-3 align-top whitespace-nowrap font-medium leading-tight">
                      {item.tgl_mulai ? formatBeautifulDateTime(item.tgl_mulai.split('T')[0]) : '-'} <span className="text-slate-400">s/d</span><br/>{item.tgl_selesai ? formatBeautifulDateTime(item.tgl_selesai.split('T')[0]) : '-'}
                    </td>
                    <td className="p-1.5 sm:p-3 align-top min-w-[120px] sm:min-w-[150px] whitespace-normal break-words leading-tight">
                      {item.keterangan || '-'}
                      {item.alasan_ditolak && sts === 'DITOLAK' && (
                        <div className="text-[9px] sm:text-xs text-red-500 dark:text-red-400 mt-1 font-medium">Alasan Tolak: {item.alasan_ditolak}</div>
                      )}
                    </td>
                    <td className="p-1.5 sm:p-3 align-top">
                      <span className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[9px] sm:text-xs font-bold block w-max leading-none ${bcol}`}>{item.status || '-'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {developerMode && izinLog && (
        <DevLogSection 
          title="API: history_Izin" 
          filename="history_izin_reqrespon.txt" 
          request={izinLog.request} 
          response={izinLog.response} 
        />
      )}

      {modalImg && (
        <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />
      )}
    </div>
  );
}
