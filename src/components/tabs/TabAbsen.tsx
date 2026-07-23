import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Calendar, Clock, UploadCloud, Camera as CameraIcon, Image as ImageIcon, Send, CheckCircle, AlertTriangle, X, Search, User, Check, MapPin, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppContext } from '../../context/AppContext';
import { sendRequest } from '../../api';
import DevLogSection from '../DevLogSection';
import ImageLightbox from '../ui/ImageLightbox';
import { useBackButton } from '../../hooks/useBackButton';
import { getTodayWIB } from '../../lib/dateFormatter';
import { getPegawaiDatabase } from '../../data/database';
import { dataLokasi } from '../../data/data_lokasi';

// Helper function to find matching location in dataLokasi
function findMatchingLocation(pegawai: any, locations: any[]) {
  if (!pegawai) return null;

  const pNamaLokasi = (pegawai.nama_lokasi || '').toLowerCase().trim();
  const pUnor = (pegawai.unor || '').toLowerCase().trim();
  const pInstansi = (pegawai.instansi || '').toLowerCase().trim();
  const pKodeInstansi = (pegawai.kode_instansi || '').trim();

  // 1. Match by exact id if pegawai has id_lokasi
  if (pegawai.id_lokasi) {
    const found = locations.find(l => l.id === pegawai.id_lokasi);
    if (found) return found;
  }

  // 2. Exact match on normalized nama_lokasi
  if (pNamaLokasi) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pNamaLokasi);
    if (found) return found;
  }

  // 3. Exact match on normalized unor/instansi
  if (pUnor) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pUnor);
    if (found) return found;
  }
  if (pInstansi) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pInstansi);
    if (found) return found;
  }

  // 4. Substring match on nama_lokasi
  if (pNamaLokasi) {
    const found = locations.find(l => {
      const lNama = (l.nama || '').toLowerCase();
      return lNama.includes(pNamaLokasi) || pNamaLokasi.includes(lNama);
    });
    if (found) return found;
  }

  // 5. Substring match on unor/instansi
  if (pUnor) {
    const found = locations.find(l => {
      const lNama = (l.nama || '').toLowerCase();
      return lNama.includes(pUnor) || pUnor.includes(lNama);
    });
    if (found) return found;
  }

  // 6. Match by kode
  if (pKodeInstansi) {
    const found = locations.find(l => l.kode === pKodeInstansi);
    if (found) return found;
  }

  // Fallback: return first location with valid coordinates or null
  return locations.find(l => l.latitude && l.longitude) || null;
}

export default function TabAbsen() {
  const { pegawai, config, developerMode, userRole, tabPermissions } = useAppContext();
  const [tanggal, _setTanggal] = useState(() => getTodayWIB());
  const [displayTanggal, setDisplayTanggal] = useState('');
  const [timeStr, setTimeStr] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB';
  });
  const [fileInfo, setFileInfo] = useState('');
  const [base64Image, setBase64Image] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<{ type: 'success'|'error', text: string } | null>(null);
  const [absenLog, setAbsenLog] = useState<{ request: any; response: any } | null>(null);
  const [modalImg, setModalImg] = useState<{ src: string, title: string } | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // Pegawai Search states
  const [searchPegawai, setSearchPegawai] = useState('');
  const [showPegawaiDropdown, setShowPegawaiDropdown] = useState(false);
  const [pegawaiList, setPegawaiList] = useState<any[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(false);
  const [selectedTargetPegawai, setSelectedTargetPegawai] = useState<any>(null); // Full profile of chosen pegawai
  const [selectedTargetLocation, setSelectedTargetLocation] = useState<any>(null); // Matched location from dataLokasi
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const filteredPegawai = searchPegawai.trim() === '' 
    ? [] 
    : pegawaiList
        .filter(p => 
          p.nama.toLowerCase().includes(searchPegawai.toLowerCase()) || 
          p.nip.includes(searchPegawai)
        )
        .slice(0, 50);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  // Hook up back button to stop camera
  useBackButton(() => {
    stopCamera();
    return true;
  }, isCameraActive);

  // Hook up back button to close confirm modal
  useBackButton(() => {
    setIsConfirmOpen(false);
    return true;
  }, isConfirmOpen);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tanggal) {
      const [year, month, day] = tanggal.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      setDisplayTanggal(d.toLocaleDateString('id-ID', options));
    }
  }, [tanggal]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB');
    };
    tick(); // run once immediately
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Cleanup camera when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Lazy load pegawai list on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoadingPegawai(true);
      try {
        const fullDb = getPegawaiDatabase();
        const list = (fullDb || []).map((item: any) => ({
          id: item?.id || item?.id_pegawai || '',
          nip: item?.nip || '',
          nama: item?.nama || '',
          nama_instansi: item?.nama_instansi || item?.unor || item?.nama_unit_kerja || '',
          kode_unor: item?.kode_unor || item?.unor || ''
        })).filter((p: any) => p.id && p.nama);
        setPegawaiList(list);
      } catch (e) {
        console.error("Error lazy loading pegawai list in TabAbsen:", e);
      } finally {
        setLoadingPegawai(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  // Click outside listener for autocomplete dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPegawaiDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPegawai = (p: any) => {
    setSearchPegawai(`${p.nama} (${p.nip})`);
    setShowPegawaiDropdown(false);
    
    // Find full profile from database
    const fullDb = getPegawaiDatabase();
    const fullUser = fullDb.find((item: any) => item.id === p.id || item.nip === p.nip);
    if (fullUser) {
      setSelectedTargetPegawai(fullUser);
      const matchedLoc = findMatchingLocation(fullUser, dataLokasi);
      setSelectedTargetLocation(matchedLoc);
    }
  };

  const handleClearSelection = () => {
    setSearchPegawai('');
    setSelectedTargetPegawai(null);
    setSelectedTargetLocation(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.match(/image.*/)) {
      alert("Pilih file gambar!");
      return;
    }
    
    setFileInfo("🔄 Memproses & kompresi foto...");
    setBase64Image('');
    setOutput(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const TARGET_W = 240;
        const TARGET_H = 320;

        const canvas = document.createElement('canvas');
        canvas.width = TARGET_W;
        canvas.height = TARGET_H;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Cover crop: isi penuh 240×320 tanpa distorsi, crop tengah
          const srcW = img.width;
          const srcH = img.height;
          const scale = Math.max(TARGET_W / srcW, TARGET_H / srcH);
          const scaledW = srcW * scale;
          const scaledH = srcH * scale;
          const offsetX = (TARGET_W - scaledW) / 2;
          const offsetY = (TARGET_H - scaledH) / 2;
          ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const byteLength = Math.round((dataUrl.length * 3) / 4);
          setBase64Image(dataUrl);
          setFileInfo(`✅ ${TARGET_W}×${TARGET_H} px · ${(byteLength / 1024).toFixed(1)} KB`);
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const startCamera = async () => {
    if (isMobile) {
      cameraInputRef.current?.click();
      return;
    }
    
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      });
      streamRef.current = mediaStream;
      setIsCameraActive(true);
      
      // We need a slight delay to ensure the video element is rendered
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(console.error);
        }
      }, 100);
    } catch (err) {
      alert("Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.");
      console.error(err);
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  const capturePhoto = () => {
    if (videoRef.current) {
      const TARGET_W = 240;
      const TARGET_H = 320;
      const canvas = document.createElement('canvas');
      canvas.width = TARGET_W;
      canvas.height = TARGET_H;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Cover crop dari live camera feed
        const srcW = videoRef.current.videoWidth  || videoRef.current.offsetWidth;
        const srcH = videoRef.current.videoHeight || videoRef.current.offsetHeight;
        const scale = Math.max(TARGET_W / srcW, TARGET_H / srcH);
        const scaledW = srcW * scale;
        const scaledH = srcH * scale;
        const offsetX = (TARGET_W - scaledW) / 2;
        const offsetY = (TARGET_H - scaledH) / 2;
        ctx.drawImage(videoRef.current, offsetX, offsetY, scaledW, scaledH);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
            processFile(file);
            stopCamera();
          }
        }, 'image/jpeg', 0.92);
      }
    }
  };

  const submitAbsen = async () => {
    if (!base64Image) return;
    
    setLoading(true);
    setOutput(null);
    setAbsenLog(null);
    
    const finalPegawai = selectedTargetPegawai || pegawai;
    const finalIdLokasi = selectedTargetLocation ? selectedTargetLocation.id : config.idLokasi;
    const finalLat = selectedTargetLocation ? selectedTargetLocation.latitude : config.latitude;
    const finalLng = selectedTargetLocation ? selectedTargetLocation.longitude : config.longitude;

    const payload = {
      tanggal: tanggal,
      keterangan: "Presensi Reguler",
      lampiran: base64Image.split(',')[1],
      sim_serial: selectedTargetPegawai ? (selectedTargetPegawai.emei || config.deviceId) : config.deviceId,
      lattitude: finalLat,
      longitude: finalLng,
      imei: selectedTargetPegawai ? (selectedTargetPegawai.emei || config.deviceId) : config.deviceId,
      kode_instansi: selectedTargetPegawai ? (selectedTargetPegawai.kode_instansi || config.kodeInstansi) : config.kodeInstansi,
      id_lokasi: finalIdLokasi,
      work_mode: config.workMode,
      id_pegawai: finalPegawai?.id || config.idPegawai,
      bedgenumber: selectedTargetPegawai ? (selectedTargetPegawai.badgenumber || config.deviceId) : config.deviceId,
      versi: config.versi
    };

    try {
      const data = await sendRequest("/login/absen_mobile", payload);
      setAbsenLog({ request: payload, response: data });
      
      if (data.success) {
        setOutput({ type: 'success', text: `✅ PRESENSI BERHASIL!\n${data.message || 'Sukses'}` });
      } else {
        setOutput({ type: 'error', text: `❌ GAGAL PRESENSI\n${data.message || 'Error'}` });
      }
    } catch (err: any) {
      setAbsenLog({ request: payload, response: { error: err.message } });
      setOutput({ type: 'error', text: `❌ Network Error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  if (!pegawai) {
    return null; // App.tsx auto-redirect ke tabLogin
  }

  // Apakah user boleh mencari & memilih pegawai lain?
  // Admin selalu bisa. User hanya bisa jika allowSearchPegawai diaktifkan admin.
  const canSearchPegawai = userRole === 'admin' || (tabPermissions.allowSearchPegawai ?? false);

  return (
    <>
      <div className="w-full mx-auto bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60 relative z-20">
      
      <div className="flex items-center gap-3 mb-8 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
          <Calendar className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Presensi</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Unggah atau ambil foto untuk presensi</p>
        </div>
      </div>

      {/* Pegawai Search Section - hanya tampil jika canSearchPegawai */}
      {canSearchPegawai ? (
      <div className="bg-slate-50 dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/60 mb-6 space-y-4 relative z-40">
        <div className="relative" ref={dropdownRef}>
          <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <User className="w-4 h-4 text-blue-500" /> Cari & Pilih Pegawai (Opsional)
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchPegawai}
              onChange={(e) => {
                setSearchPegawai(e.target.value);
                setShowPegawaiDropdown(true);
              }}
              onFocus={() => setShowPegawaiDropdown(true)}
              placeholder="Ketik nama atau NIP pegawai..."
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 font-medium placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-100 shadow-sm"
            />
            <div className="absolute left-3 top-3.5 text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            {searchPegawai && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Autocomplete recommendations list */}
          {showPegawaiDropdown && (
            <div className="absolute left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
              {loadingPegawai ? (
                <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> Memuat database pegawai...
                </div>
              ) : filteredPegawai.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs font-medium">
                  {searchPegawai.trim() === '' ? 'Silakan ketik nama atau NIP untuk mencari' : 'Pegawai tidak ditemukan'}
                </div>
              ) : (
                filteredPegawai.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPegawai(p)}
                    className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex flex-col gap-0.5"
                  >
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <span>NIP: {p.nip}</span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="truncate">{p.nama_instansi}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Selected Pegawai Details */}
        {selectedTargetPegawai ? (
          <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/40 dark:bg-blue-950/10 space-y-3 animate-fade-in">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-widest">Pegawai Terpilih</span>
                <h4 className="text-sm font-bold text-slate-800 dark:text-white mt-0.5">{selectedTargetPegawai.nama}</h4>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">NIP: <span className="font-mono">{selectedTargetPegawai.nip}</span></p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{selectedTargetPegawai.unor || selectedTargetPegawai.instansi}</p>
              </div>
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-100 dark:border-red-950/30 transition-colors"
              >
                Reset ke Default
              </button>
            </div>

            <div className="h-px bg-slate-200/60 dark:bg-slate-700/50" />

            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Detail Lokasi Presensi</span>
                {selectedTargetLocation ? (
                  <div className="mt-0.5">
                    <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">{selectedTargetLocation.nama}</h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{selectedTargetLocation.alamat || 'Tidak ada alamat terdaftar'}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span>Lat: {selectedTargetLocation.latitude}</span>
                      <span>Lng: {selectedTargetLocation.longitude}</span>
                      <span>Radius: {selectedTargetLocation.radius}m</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-rose-500 font-semibold mt-0.5">
                    ⚠️ Lokasi "{selectedTargetPegawai.nama_lokasi || 'Tidak diketahui'}" tidak ditemukan di database lokasi. Menggunakan koordinat default Anda.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            Menggunakan akun login Anda: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong> dengan lokasi default perangkat ({config.latitude || '0'}, {config.longitude || '0'}).
          </div>
        )}
      </div>
      ) : (
      /* Info akun login (tampil saat pencarian pegawai disembunyikan) */
      <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 mb-6">
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0"></span>
          Presensi untuk: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>
        </div>
      </div>
      )}

      {/* Date & Time Section - Positioned underneath Pegawai selector */}
      <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4 sm:p-5 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-30">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="flex-1 sm:flex-initial">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Tanggal</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">{displayTanggal}</div>
          </div>
        </div>
        <div className="w-px h-10 bg-slate-200 dark:bg-slate-700 hidden sm:block"></div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Waktu</div>
            <div className="text-sm font-semibold font-mono text-slate-900 dark:text-slate-200">{timeStr}</div>
          </div>
        </div>
      </div>

      <div className="space-y-6 relative z-10">
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Foto Presensi</label>
          
          <div 
            className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 sm:p-12 text-center bg-slate-50 dark:bg-slate-900/30 hover:border-blue-400 dark:hover:border-blue-500/50 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all cursor-pointer group"
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <div className="mb-6 flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-center text-slate-400 group-hover:text-blue-500 group-hover:scale-110 transition-all">
                <UploadCloud className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Tarik & lepas foto di sini</p>
                <p className="text-xs text-slate-400 mt-1">Foto akan dikompres ke 240×320 px (cover crop, tanpa distorsi)</p>
              </div>
            </div>
            <div className="flex justify-center gap-3 flex-wrap">
              <button type="button" onClick={startCamera} className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 active:scale-95">
                <CameraIcon className="w-4 h-4" /> Buka Kamera
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 border border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 active:scale-95">
                <ImageIcon className="w-4 h-4" /> Pilih File
              </button>
            </div>
          </div>
        </div>
        
        <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileChange} />
        <input type="file" ref={cameraInputRef} accept="image/*" capture="user" className="hidden" onChange={handleFileChange} />
        
        {/* Live Camera View */}
        {isCameraActive && (
          <div className="fixed inset-0 z-50 bg-black flex flex-col">
            <div className="flex justify-between items-center p-4 bg-black text-white">
              <span className="font-medium">Ambil Foto Presensi</span>
              <button onClick={stopCamera} className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
              <video 
                ref={videoRef} 
                playsInline 
                autoPlay 
                muted
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="p-8 bg-black flex justify-center items-center pb-12">
              <button 
                onClick={capturePhoto} 
                className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 shadow-lg active:scale-95 transition-transform flex items-center justify-center"
              >
                <div className="w-16 h-16 bg-white border-2 border-slate-200 rounded-full"></div>
              </button>
            </div>
          </div>
        )}

        {base64Image && !isCameraActive && (
          <div className="mt-8 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-900/30 flex flex-col items-center justify-center animate-fade-in-up">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Pratinjau Foto Presensi</h4>
            
            <div className="relative rounded-2xl overflow-hidden shadow-md border border-slate-200 dark:border-slate-700 max-w-full max-h-[300px] flex justify-center bg-slate-100 dark:bg-slate-950">
              <img 
                src={base64Image} 
                alt="Pratinjau Foto" 
                className="max-w-full max-h-[300px] object-contain cursor-pointer transition-transform duration-300 hover:scale-[1.01]" 
                onClick={() => setModalImg({ src: base64Image, title: 'Pratinjau Foto Presensi' })}
              />
            </div>

            {/* Controls directly under photo */}
            <div className="flex justify-center gap-3 mt-4 w-full max-w-xs">
              <button 
                type="button" 
                onClick={() => setModalImg({ src: base64Image, title: 'Pratinjau Foto Presensi' })}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-slate-200/40 dark:border-slate-700/40 cursor-pointer"
              >
                <Search className="w-4 h-4" /> Lihat Detail
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setBase64Image('');
                  setFileInfo('');
                  setOutput(null);
                }}
                className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-rose-100 dark:border-rose-950/30 cursor-pointer"
              >
                <X className="w-4 h-4" /> Hapus Foto
              </button>
            </div>

            {/* Keterangan sukses dan berapa ukurannya di bawah fotonya (jangan di sampingnya!) */}
            <div className="mt-4 flex flex-col items-center text-center gap-1.5">
              <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/20 text-xs font-bold">
                <CheckCircle className="w-3.5 h-3.5" /> Foto Berhasil Diproses
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {fileInfo}
              </span>
            </div>
          </div>
        )}
        
        {/* Card Section for Kirim Presensi */}
        <div className="mt-8 p-6 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 shadow-md flex flex-col gap-4">
          <button 
            onClick={() => setIsConfirmOpen(true)}
            disabled={!base64Image || loading} 
            className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-4 px-4 rounded-xl transition-all text-base flex items-center justify-center gap-2 active:scale-[0.98] shadow-md cursor-pointer border border-blue-700 dark:border-blue-400"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <Send className="w-5 h-5" />
            )}
            {loading ? 'Mengirim Data Presensi...' : 'Kirim Presensi Sekarang'}
          </button>
        </div>
        
        {output && (
          <div className={`mt-6 p-4 rounded-xl text-sm font-semibold shadow-sm ${output.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}>
            <div className="flex items-center gap-3">
              {output.type === 'success' ? <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0" />}
              <span className="font-sans whitespace-pre-wrap leading-relaxed">{output.text}</span>
            </div>
          </div>
        )}

        {developerMode && absenLog && (
          <DevLogSection 
            title="API: absen_mobile" 
            filename="absen_reqrespon.txt" 
            request={absenLog.request} 
            response={absenLog.response} 
          />
        )}
      </div>
    </div>
      
    {modalImg && (
      <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />
    )}

    {/* Confirmation Modal */}
    <AnimatePresence>
      {isConfirmOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsConfirmOpen(false)}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
          />
          
          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800/80 overflow-hidden flex flex-col z-10 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
              <span className="font-bold text-slate-800 dark:text-white text-sm">Konfirmasi Kirim Presensi</span>
              <button 
                onClick={() => setIsConfirmOpen(false)} 
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-400 p-4 rounded-2xl mb-5 border border-blue-100 dark:border-blue-900/30">
              <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <p className="text-xs font-semibold leading-relaxed">
                Mohon periksa kembali detail presensi Anda di bawah ini sebelum mengirim data.
              </p>
            </div>

            {/* Info Table / Details */}
            <div className="space-y-3.5 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 mb-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nama Pegawai</span>
                <span className="text-sm font-bold text-slate-800 dark:text-white">{pegawai?.nama || 'Tidak Tersedia'}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />
              
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">NIP</span>
                <span className="text-sm font-semibold font-mono text-slate-700 dark:text-slate-300">{pegawai?.nip || '-'}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />

              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tanggal</span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{displayTanggal}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />

              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Waktu</span>
                <span className="text-sm font-semibold font-mono text-slate-700 dark:text-slate-300">{timeStr}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="w-full py-3 px-4 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors cursor-pointer text-center"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmOpen(false);
                  submitAbsen();
                }}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Ya, Kirim
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </>
  );
}
