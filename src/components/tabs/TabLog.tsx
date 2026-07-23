import React, { useState, useEffect, useRef } from 'react';
import { FileText, Search, CheckCircle, Calendar as CalendarIcon, ImageIcon, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { sendRequest } from '../../api';
import DatePicker from '../ui/DatePicker';
import DevLogSection from '../DevLogSection';
import { formatBeautifulDateTime, getTodayWIB, getTodayWIBWithOffset } from '../../lib/dateFormatter';
import ImageLightbox from '../ui/ImageLightbox';
import { useBackButton } from '../../hooks/useBackButton';
import LazyImage from '../ui/LazyImage';
import { reportPegawaiList } from '../../data/database';

export default function TabLog() {
  const { pegawai, config, developerMode, tabPermissions, userRole } = useAppContext();

  const canTerkini = userRole === 'admin' || tabPermissions.tabLogPresensiTerkini;
  const canLengkap  = userRole === 'admin' || tabPermissions.tabLogLengkap;
  // Boleh cari pegawai lain jika admin atau permission allowSearchPresensi aktif
  const canSearchPresensi = userRole === 'admin' || tabPermissions.allowSearchPresensi;

  // Default ke tab yang boleh diakses
  const [activeSubTab, setActiveSubTab] = useState<'hari_ini' | 'lengkap'>(() =>
    canTerkini ? 'hari_ini' : 'lengkap'
  );

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

  // --- Presensi Terkini ---
  const [hariIniDate, setHariIniDate] = useState(() => getTodayWIB());
  const [loadingHariIni, setLoadingHariIni] = useState(false);
  const [dataHariIni, setDataHariIni] = useState<any[] | null>(null);
  const [errorHariIni, setErrorHariIni] = useState('');
  const [modalImg, setModalImg] = useState<{ src: string; title: string; images?: { src: string; title: string }[]; currentIndex?: number } | null>(null);
  const [hariIniLog, setHariIniLog] = useState<{ request: any; response: any } | null>(null);
  const [visibleCountHariIni, setVisibleCountHariIni] = useState(50);
  const [visibleCountLengkap, setVisibleCountLengkap] = useState(50);

  // Pre-calculate all images in dataHariIni
  const allImages = React.useMemo(() => {
    if (!dataHariIni) return [];
    return dataHariIni.slice(0, visibleCountHariIni).map((item) => {
      let lamp = item.lampiran || item.foto;
      let hasImage = false;
      let imgUrl = '';
      
      if (lamp && lamp !== 'no_image.png' && !lamp.includes('no_image')) {
        hasImage = true;
        if (lamp.startsWith('/9j/') || lamp.startsWith('iVBOR')) {
          imgUrl = `data:image/jpeg;base64,${lamp}`;
        } else if (lamp.startsWith('http')) {
          imgUrl = lamp;
        } else {
          imgUrl = `/api/proxy-image?path=${encodeURIComponent(lamp)}`;
        }
      }

      if (!hasImage) return null;

      let displayStatus = item.status_absen || '-';
      if (item.jam) {
        const cleanJam = item.jam.trim();
        let hour = -1;
        let dayOfWeek = -1;

        const fullDateTimeMatch = cleanJam.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (fullDateTimeMatch) {
          const year = parseInt(fullDateTimeMatch[1], 10);
          const month = parseInt(fullDateTimeMatch[2], 10) - 1;
          const date = parseInt(fullDateTimeMatch[3], 10);
          hour = parseInt(fullDateTimeMatch[4], 10);
          const dt = new Date(year, month, date);
          dayOfWeek = dt.getDay();
        } else {
          const justTimeMatch = cleanJam.match(/^(\d{2}):(\d{2})/);
          if (justTimeMatch) {
            hour = parseInt(justTimeMatch[1], 10);
          }
        }

        if (dayOfWeek === -1) {
          try {
            const parsedDate = new Date(cleanJam);
            if (!isNaN(parsedDate.getTime())) {
              hour = parsedDate.getHours();
              dayOfWeek = parsedDate.getDay();
            }
          } catch (e) {}
        }

        if (dayOfWeek === -1) {
          dayOfWeek = new Date().getDay();
        }

        if (hour !== -1) {
          if (dayOfWeek === 5) {
            displayStatus = hour >= 11 ? 'Absen Pulang' : 'Absen Masuk';
          } else {
            displayStatus = hour >= 15 ? 'Absen Pulang' : 'Absen Masuk';
          }
        }
      }

      return {
        src: imgUrl,
        title: `${displayStatus} - ${formatBeautifulDateTime(item.jam)}`
      };
    }).filter((img): img is { src: string; title: string } => img !== null);
  }, [dataHariIni, visibleCountHariIni]);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  // --- Log Lengkap ---
  const [tglAwal, setTglAwal] = useState(getTodayWIBWithOffset(-1));
  const [tglAkhir, setTglAkhir] = useState(() => getTodayWIB());
  const [loadingLengkap, setLoadingLengkap] = useState(false);
  const [dataLengkap, setDataLengkap] = useState<any[] | null>(null);
  const [errorLengkap, setErrorLengkap] = useState('');
  const [lengkapLog, setLengkapLog] = useState<{ request: any; response: any } | null>(null);

  const handleScrollHariIni = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (dataHariIni && visibleCountHariIni < dataHariIni.length) {
        setVisibleCountHariIni(prev => prev + 50);
      }
    }
  };

  const handleScrollLengkap = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (dataLengkap && visibleCountLengkap < dataLengkap.length) {
        setVisibleCountLengkap(prev => prev + 50);
      }
    }
  };

  const fetchHariIni = async (targetDate: string = hariIniDate) => {
    setLoadingHariIni(true);
    setErrorHariIni('');
    setDataHariIni(null);
    setHariIniLog(null);
    setVisibleCountHariIni(50);
    // Jika tidak punya izin search, selalu gunakan id sendiri
    const effectivePegawai = canSearchPresensi ? selectedPegawai : null;
    const payload = {
      id_pegawai: effectivePegawai ? effectivePegawai.id : config.idPegawai,
      tanggal: targetDate
    };
    try {
      const res = await sendRequest("/logActivity/log_detail", payload);
      setHariIniLog({ request: payload, response: res });
      if (res && res.message !== "Data kosong" && res.data && res.data.length > 0) {
        setDataHariIni(res.data);
      } else {
        setErrorHariIni(`Belum ada data presensi untuk tanggal ${targetDate}.`);
      }
    } catch (err: any) {
      setHariIniLog({ request: payload, response: { error: err.message } });
      setErrorHariIni(`Network Error: ${err.message}`);
    } finally {
      setLoadingHariIni(false);
    }
  };

  const fetchLengkap = async () => {
    setLoadingLengkap(true);
    setErrorLengkap('');
    setDataLengkap(null);
    setLengkapLog(null);
    setVisibleCountLengkap(50);
    // Jika tidak punya izin search, selalu gunakan id sendiri
    const effectivePegawai = canSearchPresensi ? selectedPegawai : null;
    const payload = {
      id_pegawai: effectivePegawai ? effectivePegawai.id : config.idPegawai,
      tgl_awal: tglAwal,
      tgl_akhir: tglAkhir
    };
    try {
      const res = await sendRequest("/logActivity/log", payload);
      setLengkapLog({ request: payload, response: res });
      if (res && res.success && res.data && res.data.length > 0) {
        setDataLengkap(res.data);
      } else {
        setErrorLengkap('Data kosong pada rentang tanggal tersebut.');
      }
    } catch (err: any) {
      setLengkapLog({ request: payload, response: { error: err.message } });
      setErrorLengkap(`Network Error: ${err.message}`);
    } finally {
      setLoadingLengkap(false);
    }
  };

  // Auto fetch Presensi Terkini on mount or when date or selected employee changes
  useEffect(() => {
    if (!pegawai) return;
    if (activeSubTab === 'hari_ini') {
      fetchHariIni(hariIniDate);
    }
  }, [activeSubTab, hariIniDate, pegawai, canSearchPresensi ? selectedPegawai : null]);

  if (!pegawai) {
    return null; // App.tsx will auto-redirect to tabLogin
  }

  return (
    <div className="w-full mx-auto bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex flex-col relative z-20">
      {/* Header Visual (optional decorative element) */}
      <div className="relative h-24 bg-gradient-to-r from-blue-500 to-purple-600 dark:from-blue-600 dark:to-purple-800 rounded-t-3xl overflow-hidden shrink-0">
        <div className="absolute inset-0 bg-white/20 dark:bg-black/20" style={{ backdropFilter: 'blur(10px)' }}></div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 relative z-10 -mt-2 rounded-t-2xl shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        {canTerkini && (
          <button
            className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-all duration-300 relative ${
              activeSubTab === 'hari_ini'
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
            onClick={() => setActiveSubTab('hari_ini')}
          >
            <CalendarIcon className={`w-4 h-4 ${activeSubTab === 'hari_ini' ? 'animate-bounce-subtle' : ''}`} /> Presensi Terkini
            {activeSubTab === 'hari_ini' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-t-full"></div>
            )}
          </button>
        )}
        {canLengkap && (
          <button
            className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-all duration-300 relative ${
              activeSubTab === 'lengkap'
                ? 'text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-900/10'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
            onClick={() => setActiveSubTab('lengkap')}
          >
            <FileText className={`w-4 h-4 ${activeSubTab === 'lengkap' ? 'animate-bounce-subtle' : ''}`} /> Log Lengkap
            {activeSubTab === 'lengkap' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 dark:bg-purple-400 rounded-t-full"></div>
            )}
          </button>
        )}
      </div>

      <div className="p-4 sm:p-6">
        {/* Search Pegawai Section - hanya tampil jika punya izin */}
        {canSearchPresensi ? (
        <div className={`mb-6 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 relative ${showPegawaiDropdown ? 'z-[60]' : 'z-30'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
                Cek History Presensi
              </span>
              <h4 className="text-sm font-bold text-slate-850 dark:text-slate-200 flex items-center gap-1.5">
                {selectedPegawai ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse inline-block" />
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
                  className="w-full bg-white dark:bg-slate-800 text-slate-850 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-14 py-2 text-xs font-bold focus:outline-none focus:border-blue-500 shadow-sm"
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
          <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200/60 dark:border-blue-700/50 flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 inline-block" />
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Data Login Anda</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{pegawai.nama} • NIP: {pegawai.nip}</p>
            </div>
          </div>
        )}

        {/* Konten Presensi Hari Ini */}
        {activeSubTab === 'hari_ini' && (
          <div className="space-y-6">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 relative z-30">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-blue-500" /> Detail & Foto
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Log dan foto presensi tanggal terpilih
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
                <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
                  {/* Button 1 Hari Sebelum */}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const [year, month, day] = hariIniDate.split('-').map(Number);
                        const targetDate = new Date(year, month - 1, day - 1);
                        const y = targetDate.getFullYear();
                        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
                        const d = String(targetDate.getDate()).padStart(2, '0');
                        setHariIniDate(`${y}-${m}-${d}`);
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    className="p-1.5 xs:p-2 sm:p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-blue-300 dark:hover:border-blue-600 active:scale-95 shadow-xs transition-all shrink-0"
                    title="1 Hari Sebelum"
                  >
                    <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  <DatePicker
                    value={hariIniDate}
                    onChange={(newDate) => setHariIniDate(newDate)}
                    className="flex-1 sm:w-[280px]"
                  />

                  {/* Button 1 Hari Sesudah */}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const [year, month, day] = hariIniDate.split('-').map(Number);
                        const targetDate = new Date(year, month - 1, day + 1);
                        const y = targetDate.getFullYear();
                        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
                        const d = String(targetDate.getDate()).padStart(2, '0');
                        setHariIniDate(`${y}-${m}-${d}`);
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    className="p-1.5 xs:p-2 sm:p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-blue-300 dark:hover:border-blue-600 active:scale-95 shadow-xs transition-all shrink-0"
                    title="1 Hari Sesudah"
                  >
                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>

                <button 
                  onClick={() => fetchHariIni(hariIniDate)}
                  disabled={loadingHariIni}
                  className="w-full sm:w-auto bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 font-semibold py-2 sm:py-2.5 px-3.5 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 text-xs sm:text-sm active:scale-95 whitespace-nowrap"
                >
                  <Search className={`w-4 h-4 ${loadingHariIni ? 'animate-spin text-blue-500' : 'text-slate-400'}`} /> 
                  {loadingHariIni ? 'Menyegarkan...' : 'Segarkan Data'}
                </button>
              </div>
            </div>

            {errorHariIni && (
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50 font-mono text-sm rounded-xl flex gap-3 items-start">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="leading-relaxed">{errorHariIni}</span>
              </div>
            )}

            {dataHariIni && (
              <div 
                className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 rounded-2xl overflow-x-auto custom-scrollbar shadow-sm"
                onScroll={handleScrollHariIni}
                style={{ maxHeight: '500px' }}
              >
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Status/Waktu</th>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Instansi</th>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Alamat</th>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-center whitespace-nowrap shadow-sm">Foto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {dataHariIni.slice(0, visibleCountHariIni).map((item, i) => {
                      let lamp = item.lampiran || item.foto;
                      let hasImage = false;
                      let imgUrl = '';
                      
                      if (lamp && lamp !== 'no_image.png' && !lamp.includes('no_image')) {
                        hasImage = true;
                        if (lamp.startsWith('/9j/') || lamp.startsWith('iVBOR')) {
                          imgUrl = `data:image/jpeg;base64,${lamp}`;
                        } else if (lamp.startsWith('http')) {
                          imgUrl = lamp;
                        } else {
                          imgUrl = `/api/proxy-image?path=${encodeURIComponent(lamp)}`;
                        }
                      }

                      let displayStatus = item.status_absen || '-';
                      if (item.jam) {
                        const cleanJam = item.jam.trim();
                        let hour = -1;
                        let dayOfWeek = -1;

                        // 1. Matches full ISO / Date-Time formats, e.g. "2026-06-29 16:30:00" or "2026-06-29T16:30:00"
                        const fullDateTimeMatch = cleanJam.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
                        if (fullDateTimeMatch) {
                          const year = parseInt(fullDateTimeMatch[1], 10);
                          const month = parseInt(fullDateTimeMatch[2], 10) - 1;
                          const date = parseInt(fullDateTimeMatch[3], 10);
                          hour = parseInt(fullDateTimeMatch[4], 10);
                          const dt = new Date(year, month, date);
                          dayOfWeek = dt.getDay();
                        } else {
                          // 2. Matches just time strings, e.g. "16:30:00" or "16:30"
                          const justTimeMatch = cleanJam.match(/^(\d{2}):(\d{2})/);
                          if (justTimeMatch) {
                            hour = parseInt(justTimeMatch[1], 10);
                          }
                        }

                        // 3. Fallback to standard JS Date parsing if dayOfWeek is still not determined
                        if (dayOfWeek === -1) {
                          try {
                            const parsedDate = new Date(cleanJam);
                            if (!isNaN(parsedDate.getTime())) {
                              hour = parsedDate.getHours();
                              dayOfWeek = parsedDate.getDay();
                            }
                          } catch (e) {
                            // ignore
                          }
                        }

                        // 4. Default dayOfWeek to today's day of week if still -1
                        if (dayOfWeek === -1) {
                          dayOfWeek = new Date().getDay();
                        }

                        if (hour !== -1) {
                          if (dayOfWeek === 5) { // 5 is Friday
                            displayStatus = hour >= 11 ? 'Absen Pulang' : 'Absen Masuk';
                          } else {
                            displayStatus = hour >= 15 ? 'Absen Pulang' : 'Absen Masuk';
                          }
                        }
                      }

                      return (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                          <td className="p-4 align-top whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 mb-2">
                              {displayStatus}
                            </span>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                              {formatBeautifulDateTime(item.jam)}
                            </div>
                          </td>
                          <td className="p-4 align-top">
                            <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                              {item.store || '-'}
                            </div>
                          </td>
                          <td className="p-4 align-top">
                            <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
                              {item.alamat || '-'}
                            </div>
                          </td>
                          <td className="p-4 align-top">
                            <div className="flex justify-center items-center">
                              {hasImage ? (
                                <LazyImage 
                                  src={imgUrl} 
                                  alt="Absen"
                                  onClick={() => {
                                    const idx = allImages.findIndex((img) => img.src === imgUrl);
                                    setModalImg({
                                      src: imgUrl,
                                      title: `${displayStatus} - ${formatBeautifulDateTime(item.jam)}`,
                                      images: allImages,
                                      currentIndex: idx !== -1 ? idx : 0
                                    });
                                  }}
                                  containerClassName="w-16 h-16 sm:w-20 sm:h-20 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer group-hover:border-blue-400 dark:group-hover:border-blue-500/50 transition-all"
                                  className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                                />
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500 italic text-[10px] sm:text-xs">No Image</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {developerMode && hariIniLog && (
              <DevLogSection 
                title="API: log_detail" 
                filename="log_presensi_hari_ini_reqrespon.txt" 
                request={hariIniLog.request} 
                response={hariIniLog.response} 
              />
            )}
          </div>
        )}

        {/* Konten Log Lengkap */}
        {activeSubTab === 'lengkap' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-500" /> Tarik Log Rentang Tanggal
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Pilih rentang tanggal untuk melihat riwayat presensi
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-30">
              <DatePicker label="Tanggal Awal" value={tglAwal} onChange={setTglAwal} />
              <DatePicker label="Tanggal Akhir" value={tglAkhir} onChange={setTglAkhir} />
            </div>
            
            <button 
              onClick={fetchLengkap}
              disabled={loadingLengkap}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-sm transition-all mt-2 flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {loadingLengkap ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <Search className="w-5 h-5" />
              )}
              {loadingLengkap ? 'Menarik Data...' : 'Tarik Data Lengkap'}
            </button>
            
            {errorLengkap && (
              <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50 font-mono text-sm rounded-xl flex gap-3 items-start">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="leading-relaxed">{errorLengkap}</span>
              </div>
            )}
            
            {dataLengkap && (
              <div className="mt-6 space-y-4">
                <div className="inline-flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/20 text-sm font-bold">
                  <CheckCircle className="w-4 h-4" /> DATA REKAP DITEMUKAN
                </div>
                
                <div 
                  className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 rounded-2xl overflow-x-auto custom-scrollbar shadow-sm"
                  onScroll={handleScrollLengkap}
                  style={{ maxHeight: '500px' }}
                >
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Tanggal</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Masuk</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Pulang</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Status</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataLengkap.slice(0, visibleCountLengkap).map((item, i) => {
                      const statusRaw = (item.cuti || '').trim().toUpperCase();
                      const isMangkir = statusRaw === 'M';
                      const isLibur = statusRaw.includes('*');
                      
                      let keterangan = '-';
                      if (isLibur) keterangan = 'Libur';
                      else if (statusRaw === 'IS') keterangan = 'Izin Sakit';
                      else if (statusRaw === 'CS') keterangan = 'Cuti Sakit';
                      else if (statusRaw === 'CAP') keterangan = 'Cuti Alasan Penting';
                      else if (statusRaw === 'TB') keterangan = 'Tugas Belajar';
                      else if (statusRaw === 'CT') keterangan = 'Cuti Tahunan';
                      else if (statusRaw === 'P') keterangan = 'Penugasan';
                      else if (statusRaw === 'IKK') keterangan = 'Izin Kepentingan Keluarga';
                      else if (statusRaw === 'H') keterangan = 'Hadir';
                      else if (statusRaw === 'M') keterangan = 'Mangkir';
                      else if (statusRaw === 'CB') keterangan = 'Cuti Besar';
                      else if (statusRaw === 'CM') keterangan = 'Cuti Melahirkan';
                      else if (statusRaw === 'DK') keterangan = 'Diklat';
                      else if (statusRaw === 'DL') keterangan = 'Tugas Luar';
                      else if (statusRaw === 'CLTN') keterangan = 'Cuti Diluar Tanggungan Negara';
                      else if (statusRaw === '?') keterangan = 'Tidak Checkout/ Checkin 1 hari';
                      else if (statusRaw) keterangan = statusRaw;

                      return (
                        <tr key={i} className={`transition-colors group ${isMangkir ? 'bg-red-50 dark:bg-red-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                          <td className="p-4 align-top whitespace-nowrap">
                            <div className={`font-mono text-xs ${isMangkir ? 'text-red-700 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                              {formatBeautifulDateTime(item.tanggal)}
                            </div>
                          </td>
                          <td className="p-4 align-top whitespace-nowrap">
                            <div className={`font-semibold text-sm ${isMangkir ? 'text-red-400 dark:text-red-500/50' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {formatBeautifulDateTime(item.absen_masuk)}
                            </div>
                          </td>
                          <td className="p-4 align-top whitespace-nowrap">
                            <div className={`font-semibold text-sm ${isMangkir ? 'text-red-400 dark:text-red-500/50' : 'text-blue-600 dark:text-blue-400'}`}>
                              {formatBeautifulDateTime(item.absen_pulang)}
                            </div>
                          </td>
                          <td className="p-4 align-top whitespace-nowrap">
                            <span className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold border ${isMangkir ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50' : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
                              {item.cuti || '-'}
                            </span>
                          </td>
                          <td className="p-4 align-top whitespace-nowrap">
                            <div className={`text-sm ${isMangkir ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-400 font-medium'}`}>
                              {keterangan}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              {/* Legend Section */}
              <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm space-y-3">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <span>ℹ️</span> Keterangan Kode Status Presensi
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">*</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Libur</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">IS</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Izin Sakit</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">CS</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Cuti Sakit</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">CAP</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Cuti Alasan Penting</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">TB</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Tugas Belajar</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">CT</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Cuti Tahunan</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">P</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Penugasan</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">IKK</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Izin Kepentingan Keluarga</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">H</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Hadir</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">M</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Mangkir/ Alpha</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">CB</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Cuti Besar</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">CM</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Cuti Melahirkan</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">DK</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Diklat</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">DL</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Tugas Luar</span>
                  </div>
                  <div className="flex items-start gap-1 col-span-1 sm:col-span-2 lg:col-span-2">
                    <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400 min-w-[50px] shrink-0">CLTN</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-700 dark:text-slate-300 ml-1">Cuti Diluar Tanggungan Negara</span>
                  </div>
                  <div className="flex items-start gap-1 col-span-1 sm:col-span-2 md:col-span-3 lg:col-span-4 mt-1 border-t border-slate-200/50 dark:border-slate-700/50 pt-2">
                    <span className="font-mono font-extrabold text-red-500 min-w-[50px] shrink-0">?</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-600 dark:text-slate-400 ml-1 font-bold">Tidak Checkout atau Tidak Checkin Dalam 1 hari</span>
                  </div>
                </div>
              </div>
            </div>
            )}
            {developerMode && lengkapLog && (
              <DevLogSection 
                title="API: log" 
                filename="log_presensi_lengkap_reqrespon.txt" 
                request={lengkapLog.request} 
                response={lengkapLog.response} 
              />
            )}
          </div>
        )}
      </div>

      {modalImg && (
        <ImageLightbox 
          src={modalImg.src} 
          title={modalImg.title} 
          images={modalImg.images} 
          currentIndex={modalImg.currentIndex} 
          onClose={() => setModalImg(null)} 
        />
      )}
    </div>
  );
}

