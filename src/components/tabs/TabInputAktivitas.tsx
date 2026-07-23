import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Activity, Plus, Save, Clock, CheckCircle, XCircle,
  Search, X, ChevronDown, Camera, Image as ImageIcon, Trash2, Edit3, Play, RefreshCw,
  User, Loader2, ZoomIn
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { sendRequest } from '../../api';
import DevLogSection from '../DevLogSection';
import ImageLightbox from '../ui/ImageLightbox';
import { useBackButton } from '../../hooks/useBackButton';
import { getTodayWIB } from '../../lib/dateFormatter';
import { getPegawaiDatabase } from '../../data/database';
import {
  scheduleProductivityNotification,
  cancelProductivityNotification,
} from '../../lib/qstashService';
import {
  registerFCM,
  isFCMSupported,
  setupForegroundMessageListener,
} from '../../lib/fcmService';

export default function TabInputAktivitas() {
  const { pegawai, config, developerMode, userRole, tabPermissions, currentUser } = useAppContext();

  const [loadingMulai, setLoadingMulai] = useState(false);
  const [loadingAkhiri, setLoadingAkhiri] = useState(false);
  const [loadingAkhiriLanjut, setLoadingAkhiriLanjut] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [fcmRegistered, setFcmRegistered] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [devLog, setDevLog] = useState<{ request: any; response: any } | null>(null);

  // Aktivitas sedang berjalan (ongoing)
  const [ongoingTask, setOngoingTask] = useState<any>(null);
  const [hasChecked, setHasChecked] = useState(false);

  // Data tupoksi
  const [tupoksiList, setTupoksiList] = useState<any[]>([]);

  // Foto lampiran untuk akhiri aktivitas
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoInfo, setPhotoInfo] = useState('');
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const [photoModalImg, setPhotoModalImg] = useState<{ src: string; title: string } | null>(null);

  // Live camera (desktop)
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');

  // Live elapsed timer
  const [elapsedTime, setElapsedTime] = useState<string>('');

  // Form state input aktivitas baru
  const [jenis, setJenis] = useState<'TUPOKSI' | 'NON_TUPOKSI'>('TUPOKSI');
  const [idTupoksi, setIdTupoksi] = useState('');
  const [namaTupoksiTerpilih, setNamaTupoksiTerpilih] = useState('');
  const [tugasNonTupoksi, setTugasNonTupoksi] = useState('');
  const [keterangan, setKeterangan] = useState('');

  // Modal pilih tupoksi
  const [showTupoksiModal, setShowTupoksiModal] = useState(false);
  const [searchTupoksi, setSearchTupoksi] = useState('');

  // Refs untuk input file lampiran (kamera & galeri)
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Guard agar QStash tidak double-schedule untuk task yang sama
  // Key = taskId + tglMulai → schedule hanya sekali per aktivitas
  const scheduledTaskRef = useRef<string | null>(null);

  // ----------------------------------------------------------------
  // State: cari & pilih pegawai opsional (seperti TabAbsen)
  // ----------------------------------------------------------------
  const [searchPegawai, setSearchPegawai] = useState('');
  const [showPegawaiDropdown, setShowPegawaiDropdown] = useState(false);
  const [pegawaiList, setPegawaiList] = useState<any[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(false);
  const [selectedTargetPegawai, setSelectedTargetPegawai] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filtered list: maks 50, hanya tampil bila ada keyword
  const filteredPegawai = searchPegawai.trim() === ''
    ? []
    : pegawaiList
        .filter(p =>
          p.nama.toLowerCase().includes(searchPegawai.toLowerCase()) ||
          p.nip.includes(searchPegawai)
        )
        .slice(0, 50);

  // id_pegawai efektif: selected atau default login
  const effectiveIdPegawai = selectedTargetPegawai?.id || selectedTargetPegawai?.id_pegawai || config.idPegawai;

  // ----------------------------------------------------------------
  // Back button handlers
  // ----------------------------------------------------------------
  useBackButton(() => {
    if (showTupoksiModal) { setShowTupoksiModal(false); return true; }
    return false;
  }, showTupoksiModal);

  useBackButton(() => {
    setPhotoModalImg(null);
    return true;
  }, !!photoModalImg);

  useBackButton(() => {
    stopCamera();
    return true;
  }, isCameraActive);

  // ----------------------------------------------------------------
  // Lazy load database pegawai
  // ----------------------------------------------------------------
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
        })).filter((p: any) => p.id && p.nama);
        setPegawaiList(list);
      } catch (e) {
        console.error('Error lazy loading pegawai list in TabInputAktivitas:', e);
      } finally {
        setLoadingPegawai(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // Click-outside untuk tutup dropdown pegawai
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPegawaiDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cek aktivitas & tupoksi saat pertama buka, atau saat pegawai target berubah
  useEffect(() => {
    if (!pegawai) return;
    const id = selectedTargetPegawai?.id || selectedTargetPegawai?.id_pegawai || config.idPegawai;
    fetchCekAktivitas(id);
    fetchTupoksi(id);
  }, [pegawai, selectedTargetPegawai]);

  // ✅ FCM registration saat user login pertama kali (idempotent)
  // Hanya berjalan jika preferensi notifikasi user masih ON
  useEffect(() => {
    if (!pegawai || !currentUser?.id || fcmRegistered) return;

    // Cek preferensi user — jika sengaja dimatikan, jangan auto-register
    const notifPrefKey = `jadhuman_notif_enabled_${currentUser.id}`;
    const notifPref = localStorage.getItem(notifPrefKey);
    if (notifPref === 'false') return; // user matikan notifikasi, skip

    // Cek dukungan platform
    if (!isFCMSupported()) return;

    registerFCM(currentUser.id)
      .then((token) => {
        if (token) {
          setFcmRegistered(true);
          setupForegroundMessageListener((_payload) => {
            // foreground notification sudah ditampilkan oleh setupForegroundMessageListener
          });
        }
      })
      .catch(() => { /* non-fatal */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pegawai, currentUser]);

  // Cleanup camera saat komponen unmount
  useEffect(() => {
    return () => { stopCamera(); };
  }, []);

  // Live elapsed timer — update setiap detik selama ada ongoingTask
  useEffect(() => {
    if (!ongoingTask?.tgl_mulai) {
      setElapsedTime('');
      return;
    }

    const formatElapsed = () => {
      const start = new Date(ongoingTask.tgl_mulai).getTime();
      const now = Date.now();
      const diffMs = now - start;
      if (diffMs < 0) { setElapsedTime(''); return; }

      const totalSeconds = Math.floor(diffMs / 1000);
      const hours   = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        setElapsedTime(`${hours} jam ${minutes} menit ${seconds} detik`);
      } else if (minutes > 0) {
        setElapsedTime(`${minutes} menit ${seconds} detik`);
      } else {
        setElapsedTime(`${seconds} detik`);
      }
    };

    formatElapsed(); // langsung tampil tanpa delay
    const interval = setInterval(formatElapsed, 1000);
    return () => clearInterval(interval);
  }, [ongoingTask]);

  // ----------------------------------------------------------------
  // Handler pilih pegawai dari dropdown
  // ----------------------------------------------------------------
  const handleSelectPegawai = (p: any) => {
    setSearchPegawai(`${p.nama} (${p.nip})`);
    setShowPegawaiDropdown(false);
    setOngoingTask(null);
    setHasChecked(false);
    // Cari profil lengkap dari database
    const fullDb = getPegawaiDatabase();
    const fullUser = fullDb.find((item: any) => item.id === p.id || item.nip === p.nip);
    setSelectedTargetPegawai(fullUser || p);
  };

  const handleClearPegawaiSelection = () => {
    setSearchPegawai('');
    setOngoingTask(null);
    setHasChecked(false);
    setSelectedTargetPegawai(null);
  };


  // ------------------------------------------------------------------
  // Cek apakah ada aktivitas berjalan
  //
  // STRATEGI: jangan andalkan /cekaktifitas karena bisa kembalikan
  // success:true meski ada aktivitas belum diakhiri.
  // Langsung ambil data hari ini via ambilDataAktivitas, lalu cari
  // item TERAKHIR (index 0, data diurutkan terbaru) yang tgl_selesai
  // null / status BELUM DIAKHIRI.
  // ------------------------------------------------------------------
  const fetchCekAktivitas = useCallback(async (idPeg?: string) => {
    setCheckingStatus(true);
    try {
      const id = idPeg ?? (selectedTargetPegawai?.id || selectedTargetPegawai?.id_pegawai || config.idPegawai);
      const today = getTodayWIB();
      const payload = { id_pegawai: id, tgl_mulai: today, tgl_akhir: today };

      const res = await sendRequest('/Tupoksi/ambilDataAktivitas', payload);
      setDevLog({ request: payload, response: res });

      if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
        // Cari aktivitas terakhir yang belum diakhiri
        const active = res.data.find((x: any) =>
          x.status === 'BELUM DIAKHIRI' ||
          x.status === 'Proses' ||
          x.tgl_selesai === null ||
          x.tgl_selesai === undefined ||
          x.tgl_selesai === ''
        );
        setOngoingTask(active || null);

        // ✅ Schedule QStash berdasarkan tgl_mulai ongoingTask yang terdeteksi
        // Guard: hanya schedule sekali per kombinasi taskId+tglMulai
        // fetchCekAktivitas bisa dipanggil berkali-kali (refresh) — jangan double-schedule
        if (active && currentUser?.id && active.tgl_mulai) {
          const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
          const startMs      = new Date(active.tgl_mulai).getTime();
          const nowMs        = Date.now();
          const elapsedMs    = nowMs - startMs;
          const remainingMs  = TWO_HOURS_MS - elapsedMs;
          const remainingSec = Math.floor(remainingMs / 1000);

          const taskId   = active.id || active.id_log || active.id_aktifitas || '';
          const guardKey = `${taskId}__${active.tgl_mulai}`;

          // Hanya schedule jika belum pernah schedule untuk task ini
          if (scheduledTaskRef.current !== guardKey) {
            scheduledTaskRef.current = guardKey;
            const userName = pegawai?.nama || currentUser.displayName || 'User';
            const delaySec = remainingSec > 10 ? remainingSec : 5; // min 5 detik

            scheduleProductivityNotification({
              userId: currentUser.id,
              userName,
              idPegawai: id,
              taskId,
              tglMulai: active.tgl_mulai,
              delaySeconds: delaySec,
            }).then((msgId) => {
              if (msgId) {
                console.log(`[QStash] Job dijadwalkan untuk task ${taskId}, sisa ~${Math.round(delaySec/60)} menit`);
              } else {
                // Schedule gagal → reset guard agar bisa dicoba lagi
                scheduledTaskRef.current = null;
              }
            }).catch(() => {
              scheduledTaskRef.current = null;
            });
          } else {
            console.log(`[QStash] Skip double-schedule untuk task ${taskId}`);
          }
        }

        // Jika tidak ada ongoingTask → cancel job yang mungkin tersisa + reset guard
        if (!active && currentUser?.id) {
          scheduledTaskRef.current = null;
          cancelProductivityNotification({ userId: currentUser.id }).catch(() => {});
        }

      } else {
        setOngoingTask(null);
        // Cancel job jika tidak ada aktivitas berjalan + reset guard
        if (currentUser?.id) {
          scheduledTaskRef.current = null;
          cancelProductivityNotification({ userId: currentUser.id }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error('fetchCekAktivitas error:', err);
      setOngoingTask(null);
    } finally {
      setCheckingStatus(false);
      setHasChecked(true);
    }
  }, [selectedTargetPegawai, config.idPegawai, currentUser, pegawai]);

  // ------------------------------------------------------------------
  // Ambil daftar tupoksi pegawai
  // ------------------------------------------------------------------
  const fetchTupoksi = useCallback(async (idPeg?: string) => {
    try {
      const id = idPeg ?? (selectedTargetPegawai?.id || selectedTargetPegawai?.id_pegawai || config.idPegawai);
      const p = { id_pegawai: id };
      const res = await sendRequest('/Tupoksi/get_data_tupoksi', p);

      let items: any[] = [];
      if (Array.isArray(res)) items = res;
      else if (res?.data && Array.isArray(res.data)) items = res.data;
      else if (res?.tugas && Array.isArray(res.tugas)) items = res.tugas;
      else if (res?.tupoksi && Array.isArray(res.tupoksi)) items = res.tupoksi;

      setTupoksiList(items);
    } catch (err: any) {
      console.error('fetchTupoksi error:', err);
    }
  }, [selectedTargetPegawai, config.idPegawai]);

  // ------------------------------------------------------------------
  // Proses foto: pertahankan resolusi asli, kompresi JPEG sampai ≤ 500 KB.
  // Jika setelah quality minimum (0.5) masih >500 KB, scale down resolusi
  // secara proporsional hingga muat — tanpa distorsi sama sekali.
  // ------------------------------------------------------------------
  const processPhoto = (file: File) => {
    if (!file.type.match(/image.*/)) return;
    setPhotoInfo('');
    setPhoto(null);
    setIsPhotoLoading(true);

    const MAX_BYTES = 500 * 1024; // 500 KB
    const MIN_QUALITY = 0.5;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new window.Image();
      img.onload = () => {
        const drawAndEncode = (w: number, h: number, q: number): string => {
          const canvas = document.createElement('canvas');
          canvas.width  = w;
          canvas.height = h;
          canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/jpeg', q);
        };

        let w = img.width;
        let h = img.height;

        // Tahap 1: turunkan quality dulu (pertahankan resolusi)
        const qualities = [0.92, 0.85, 0.75, 0.65, MIN_QUALITY];
        let dataUrl = '';
        for (const q of qualities) {
          dataUrl = drawAndEncode(w, h, q);
          const bytes = Math.round((dataUrl.length * 3) / 4);
          if (bytes <= MAX_BYTES) break;
        }

        // Tahap 2: jika masih > 500 KB, scale down resolusi proporsional
        let bytes = Math.round((dataUrl.length * 3) / 4);
        while (bytes > MAX_BYTES && w > 200) {
          w  = Math.round(w  * 0.8);
          h  = Math.round(h  * 0.8);
          dataUrl = drawAndEncode(w, h, MIN_QUALITY);
          bytes = Math.round((dataUrl.length * 3) / 4);
        }

        setPhoto(dataUrl);
        setPhotoInfo(`✅ ${w}×${h} px · ${(bytes / 1024).toFixed(1)} KB`);
        setIsPhotoLoading(false);
      };
      img.onerror = () => {
        setIsPhotoLoading(false);
        setPhotoInfo('❌ Gagal memproses foto.');
      };
      img.src = evt.target?.result as string;
    };
    reader.onerror = () => {
      setIsPhotoLoading(false);
      setPhotoInfo('❌ Gagal membaca file.');
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPhoto(file);
    e.target.value = '';
  };

  // ------------------------------------------------------------------
  // Kamera live (desktop) — mobile pakai capture input
  // ------------------------------------------------------------------
  const startCamera = async () => {
    if (isMobile) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = mediaStream;
      setIsCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(console.error);
        }
      }, 100);
    } catch {
      alert('Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.');
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  const captureFromCamera = () => {
    if (!videoRef.current) return;
    // Ambil resolusi native video feed, biarkan processPhoto yang kompres
    const srcW = videoRef.current.videoWidth  || videoRef.current.offsetWidth;
    const srcH = videoRef.current.videoHeight || videoRef.current.offsetHeight;
    const canvas = document.createElement('canvas');
    canvas.width  = srcW;
    canvas.height = srcH;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0, srcW, srcH);
    canvas.toBlob((blob) => {
      if (blob) {
        processPhoto(new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' }));
        stopCamera();
      }
    }, 'image/jpeg', 1); // quality 1 di sini, processPhoto yang akan turunkan sampai ≤500 KB
  };

  // ------------------------------------------------------------------
  // Helper: kirim request akhiri aktivitas
  // ------------------------------------------------------------------
  const doAkhiriAktivitas = async (): Promise<boolean> => {
    if (!ongoingTask) return false;
    const cleanBase64 = photo ? photo.replace(/^data:image\/[a-z]+;base64,/, '') : '';
    const taskId = ongoingTask.id || ongoingTask.id_log || ongoingTask.id_aktifitas;
    const payload: any = {
      id_pegawai: effectiveIdPegawai,
      id_aktifitas: taskId,
      id_log: taskId,
      id: taskId,
      lampiran: cleanBase64,
      lokasi: '',
    };
    const res = await sendRequest('/Tupoksi/akhiriAktivitas', payload);
    setDevLog({ request: { ...payload, lampiran: cleanBase64 ? '[BASE64_IMAGE]' : '' }, response: res });
    return !!res?.success;
  };

  // ------------------------------------------------------------------
  // Akhiri aktivitas (selesai)
  // ------------------------------------------------------------------
  const handleAkhiriAktivitas = async () => {
    setLoadingAkhiri(true);
    setError('');
    setSuccess('');
    try {
      const ok = await doAkhiriAktivitas();
      if (ok) {
        setSuccess('Aktivitas berhasil diakhiri.');
        setOngoingTask(null);
        setPhoto(null);
        setPhotoInfo('');
        const id = effectiveIdPegawai;
        setTimeout(() => fetchCekAktivitas(id), 1500);

        // ✅ Cancel QStash notification + reset guard (aktivitas sudah selesai)
        if (currentUser?.id) {
          scheduledTaskRef.current = null;
          cancelProductivityNotification({
            userId: currentUser.id,
          }).then(() => {
            console.log('[TabInputAktivitas] QStash job berhasil dibatalkan');
          }).catch((err) => {
            console.warn('[TabInputAktivitas] Gagal cancel QStash:', err);
          });
        }
      } else {
        setError('Gagal mengakhiri aktivitas.');
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setLoadingAkhiri(false);
    }
  };

  // ------------------------------------------------------------------
  // Akhiri lalu lanjutkan dengan tugas yang sama
  // ------------------------------------------------------------------
  const handleAkhiriDanLanjutkan = async () => {
    if (!ongoingTask) return;
    setLoadingAkhiriLanjut(true);
    setError('');
    setSuccess('');
    try {
      const akhiriOk = await doAkhiriAktivitas();
      if (!akhiriOk) {
        setError('Gagal mengakhiri aktivitas sebelumnya.');
        setLoadingAkhiriLanjut(false);
        return;
      }

      const isNonTupoksi = ongoingTask.jenis === 'NON_TUPOKSI';
      const endpoint = isNonTupoksi ? '/Tupoksi/simpanNonTupoksi' : '/Tupoksi/simpanTupoksi';
      const lanjutPayload: any = { id_pegawai: effectiveIdPegawai, lokasi: '' };

      if (isNonTupoksi) {
        lanjutPayload.tugas = ongoingTask.tugas || '';
        lanjutPayload.keterangan = ongoingTask.keterangan || '';
        lanjutPayload.deskr_tupoksi = ongoingTask.keterangan || '';
      } else {
        lanjutPayload.id_tupoksi = ongoingTask.id_tupoksi || '';
        lanjutPayload.deskr_tupoksi = ongoingTask.keterangan || '';
        lanjutPayload.keterangan = ongoingTask.keterangan || '';
      }

      const lanjutRes = await sendRequest(endpoint, lanjutPayload);
      setDevLog({ request: lanjutPayload, response: { akhiri: 'success', lanjut: lanjutRes } });

      if (lanjutRes?.success) {
        setSuccess('Aktivitas dilanjutkan! Aktivitas baru sudah dimulai.');
        setPhoto(null);
        setPhotoInfo('');
        const id = effectiveIdPegawai;
        // Reset guard agar aktivitas baru bisa di-schedule
        scheduledTaskRef.current = null;
        // Cancel job lama dulu, lalu fetchCekAktivitas akan schedule ulang berdasarkan tgl_mulai baru
        if (currentUser?.id) {
          cancelProductivityNotification({ userId: currentUser.id }).catch(() => {});
        }
        setTimeout(() => fetchCekAktivitas(id), 800);
        setTimeout(() => fetchCekAktivitas(id), 2500);
      } else {
        setOngoingTask(null);
        setPhoto(null);
        setPhotoInfo('');
        setError('Aktivitas diakhiri, tapi gagal melanjutkan: ' + (lanjutRes?.message || 'Error'));
        const id = effectiveIdPegawai;
        // Cancel job karena aktivitas gagal lanjut + reset guard
        if (currentUser?.id) {
          scheduledTaskRef.current = null;
          cancelProductivityNotification({ userId: currentUser.id }).catch(() => {});
          cancelProductivityNotification({ userId: currentUser.id }).catch(() => {});
        }
        setTimeout(() => fetchCekAktivitas(id), 1000);
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setLoadingAkhiriLanjut(false);
    }
  };

  // ------------------------------------------------------------------
  // [DEVELOPER MODE] Daftarkan FCM (manual register)
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Mulai aktivitas baru
  // ------------------------------------------------------------------
  const handleMulaiAktivitas = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingMulai(true);
    setError('');
    setSuccess('');
    try {
      const endpoint = jenis === 'TUPOKSI' ? '/Tupoksi/simpanTupoksi' : '/Tupoksi/simpanNonTupoksi';
      const payload: any = { id_pegawai: effectiveIdPegawai, lokasi: '' };

      if (jenis === 'TUPOKSI') {
        if (!idTupoksi) throw new Error('Pilih Tupoksi terlebih dahulu.');
        if (!keterangan.trim()) throw new Error('Keterangan tidak boleh kosong.');
        payload.id_tupoksi = idTupoksi;
        payload.deskr_tupoksi = keterangan;
        payload.keterangan = keterangan;
      } else {
        if (!tugasNonTupoksi.trim()) throw new Error('Nama tugas tidak boleh kosong.');
        payload.tugas = tugasNonTupoksi;
        payload.keterangan = keterangan;
        payload.deskr_tupoksi = keterangan;
      }

      const res = await sendRequest(endpoint, payload);
      setDevLog({ request: payload, response: res });

      if (res?.success) {
        setSuccess('Aktivitas berhasil dimulai!');
        setKeterangan('');
        setTugasNonTupoksi('');
        setIdTupoksi('');
        setNamaTupoksiTerpilih('');
        const id = effectiveIdPegawai;
        // fetchCekAktivitas akan otomatis schedule QStash berdasarkan tgl_mulai yang terdeteksi
        setTimeout(() => fetchCekAktivitas(id), 800);
        setTimeout(() => fetchCekAktivitas(id), 2500);
      } else {
        setError(res?.message || 'Gagal memulai aktivitas.');
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setLoadingMulai(false);
    }
  };

  if (!pegawai) {
    return null; // App.tsx will auto-redirect to tabLogin
  }

  // Apakah user boleh mencari & memilih pegawai lain?
  // Admin selalu bisa. User hanya bisa jika allowSearchPegawai diaktifkan admin.
  const canSearchPegawai = userRole === 'admin' || (tabPermissions.allowSearchPegawai ?? false);

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------
  return (
    <>
    <div className="w-full mx-auto bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden flex flex-col p-6 sm:p-8 relative">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Edit3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Produktivitas Harian</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Submit produktivitas kinerja harian</p>
          </div>
        </div>
        <button
          onClick={() => {
            setHasChecked(false);
            const id = selectedTargetPegawai?.id || selectedTargetPegawai?.id_pegawai || config.idPegawai;
            fetchCekAktivitas(id);
          }}
          disabled={checkingStatus}
          className="p-2 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all disabled:opacity-40 cursor-pointer"
          title="Refresh status aktivitas"
        >
          <RefreshCw className={`w-4 h-4 ${checkingStatus ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-4">

        {/* Notifikasi error / success */}
        {error && (
          <div className="p-4 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 font-medium text-sm rounded-xl flex items-start gap-3 shadow-sm">
            <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 font-medium text-sm rounded-xl flex items-start gap-3 shadow-sm">
            <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{success}</span>
          </div>
        )}

        {/* ============================================================
            SECTION: Cari & Pilih Pegawai (Opsional) - hanya jika canSearchPegawai
        ============================================================ */}
        {canSearchPegawai ? (
        <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-3 relative z-40">
          <div className="relative" ref={dropdownRef}>
            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
              <User className="w-4 h-4 text-emerald-500" />
              Cari &amp; Pilih Pegawai <span className="font-normal text-slate-400 text-xs">(Opsional)</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchPegawai}
                onChange={(e) => { setSearchPegawai(e.target.value); setShowPegawaiDropdown(true); }}
                onFocus={() => setShowPegawaiDropdown(true)}
                placeholder="Ketik nama atau NIP pegawai..."
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 font-medium placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-100 shadow-sm"
              />
              <div className="absolute left-3 top-3 text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              {searchPegawai && (
                <button
                  type="button"
                  onClick={handleClearPegawaiSelection}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Dropdown autocomplete */}
            {showPegawaiDropdown && (
              <div className="absolute left-0 right-0 mt-1.5 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
                {loadingPegawai ? (
                  <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" /> Memuat database pegawai...
                  </div>
                ) : filteredPegawai.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs font-medium">
                    {searchPegawai.trim() === '' ? 'Ketik nama atau NIP untuk mencari' : 'Pegawai tidak ditemukan'}
                  </div>
                ) : (
                  filteredPegawai.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPegawai(p)}
                      className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex flex-col gap-0.5 cursor-pointer"
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

          {/* Info pegawai terpilih / default */}
          {selectedTargetPegawai ? (
            <div className="p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/40 dark:bg-emerald-950/10 flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Pegawai Terpilih</span>
                <h4 className="text-sm font-bold text-slate-800 dark:text-white mt-0.5">{selectedTargetPegawai.nama}</h4>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                  NIP: <span className="font-mono">{selectedTargetPegawai.nip}</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedTargetPegawai.unor || selectedTargetPegawai.nama_instansi || selectedTargetPegawai.instansi}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearPegawaiSelection}
                className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-100 dark:border-red-950/30 transition-colors shrink-0 cursor-pointer"
              >
                Reset
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              Menggunakan akun login:{' '}
              <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>
            </div>
          )}
        </div>
        ) : (
        /* Info akun login (tampil saat pencarian pegawai disembunyikan) */
        <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60">
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            Aktivitas untuk:{' '}
            <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>
          </div>
        </div>
        )}

        {/* Skeleton loading saat pertama kali cek */}
        {checkingStatus && !hasChecked && (
          <div className="animate-pulse space-y-3">
            <div className="h-28 bg-slate-100 dark:bg-slate-700/50 rounded-2xl" />
            <div className="h-10 bg-slate-100 dark:bg-slate-700/50 rounded-xl w-2/3" />
          </div>
        )}

        {/* ============================================================
            TAMPILAN 1: Ada aktivitas berjalan → Card Ongoing
        ============================================================ */}
        {!checkingStatus && hasChecked && ongoingTask && (
          <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40 rounded-2xl p-5 sm:p-6 space-y-5 relative overflow-hidden">

            {/* Badge status */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center text-orange-600 dark:text-orange-400 shrink-0 shadow-[0_0_15px_rgba(249,115,22,0.25)]">
                <Clock className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-orange-800 dark:text-orange-400 uppercase tracking-wide">
                  Aktivitas Sedang Berjalan
                </h4>
                <p className="text-xs text-orange-600/80 dark:text-orange-500/80 font-medium">
                  {selectedTargetPegawai
                    ? `Milik: ${selectedTargetPegawai.nama}`
                    : 'Selesaikan atau lanjutkan aktivitas ini'}
                </p>
              </div>
            </div>

            {/* Detail aktivitas */}
            {!ongoingTask._isDummy && (
              <div className="bg-white/60 dark:bg-slate-900/40 p-4 rounded-xl border border-orange-100/60 dark:border-orange-900/30 space-y-3 backdrop-blur-sm">
                <div className="grid grid-cols-[110px_1fr] gap-2 items-start">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Jenis</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-md w-fit">
                    {ongoingTask.jenis || 'TUPOKSI'}
                  </span>
                </div>
                <div className="grid grid-cols-[110px_1fr] gap-2 items-start border-t border-slate-100 dark:border-slate-700/40 pt-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Tugas</span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-snug">
                    {ongoingTask.tugas || ongoingTask.nama_tugas || ongoingTask.nama_tupoksi || '—'}
                  </span>
                </div>
                {ongoingTask.keterangan && (
                  <div className="grid grid-cols-[110px_1fr] gap-2 items-start border-t border-slate-100 dark:border-slate-700/40 pt-3">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Keterangan</span>
                    <span className="text-sm text-slate-600 dark:text-slate-300 italic leading-snug">
                      {ongoingTask.keterangan}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-[110px_1fr] gap-2 items-start border-t border-slate-100 dark:border-slate-700/40 pt-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Mulai</span>
                  <span className="text-sm font-mono text-slate-700 dark:text-slate-300">
                    {ongoingTask.tgl_mulai
                      ? new Date(ongoingTask.tgl_mulai).toLocaleString('id-ID', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </span>
                </div>
                {elapsedTime && (
                  <div className="grid grid-cols-[110px_1fr] gap-2 items-center border-t border-slate-100 dark:border-slate-700/40 pt-3">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Durasi</span>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-700/40 px-2.5 py-1 rounded-full tabular-nums tracking-tight">
                        <Clock className="w-3 h-3 animate-pulse shrink-0" />
                        {elapsedTime}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Upload Foto Lampiran */}
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">
                Lampiran Foto (Opsional)
              </label>

              {/* Drop zone — tampil kalau belum ada foto dan tidak sedang loading */}
              {!photo && !isPhotoLoading && (
                <div
                  className="border-2 border-dashed border-orange-200 dark:border-orange-900/50 rounded-2xl p-6 text-center bg-white/60 dark:bg-slate-900/40 hover:border-orange-400 dark:hover:border-orange-600 hover:bg-orange-50/40 dark:hover:bg-orange-900/10 transition-all cursor-pointer group"
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.match(/image.*/)) processPhoto(file);
                  }}
                >
                  <div className="flex flex-col items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Camera className="w-5 h-5 text-slate-400 group-hover:text-orange-500" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                      Tarik &amp; lepas foto di sini
                    </p>
                    <p className="text-xs text-slate-400">Foto dikompres otomatis hingga ≤ 500 KB, kualitas tetap bagus</p>
                  </div>
                  <div className="flex justify-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={startCamera}
                      className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                    >
                      <Camera className="w-4 h-4" /> Buka Kamera
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="bg-white dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-slate-700 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400 border border-slate-200 dark:border-slate-700 hover:border-orange-200 dark:hover:border-orange-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                    >
                      <ImageIcon className="w-4 h-4" /> Pilih dari Galeri
                    </button>
                  </div>
                </div>
              )}

              {/* Skeleton loading — tampil saat foto sedang diproses */}
              {isPhotoLoading && (
                <div className="border-2 border-dashed border-orange-200 dark:border-orange-900/50 rounded-2xl overflow-hidden bg-white/60 dark:bg-slate-900/40">
                  {/* Shimmer bar */}
                  <div className="relative h-52 bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="absolute inset-0"
                      style={{
                        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.4s infinite linear',
                      }}
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center animate-pulse">
                        <Camera className="w-6 h-6 text-slate-400 dark:text-slate-500" />
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-semibold">Memproses foto...</span>
                      </div>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">Mengompresi dan menyiapkan foto</p>
                    </div>
                  </div>
                  <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/60 flex items-center gap-2">
                    <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full w-2/3 animate-pulse" />
                    <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full w-1/4 animate-pulse ml-auto" />
                  </div>
                </div>
              )}

              {/* Live Camera View (desktop) */}
              {isCameraActive && (
                <div className="fixed inset-0 z-50 bg-black flex flex-col">
                  <div className="flex justify-between items-center p-4 bg-black text-white">
                    <span className="font-medium text-sm">Ambil Foto Lampiran</span>
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
                      onClick={captureFromCamera}
                      className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 shadow-lg active:scale-95 transition-transform flex items-center justify-center"
                    >
                      <div className="w-16 h-16 bg-white border-2 border-slate-200 rounded-full" />
                    </button>
                  </div>
                </div>
              )}

              {/* Preview foto — tampil setelah foto dipilih dengan animasi fade-in */}
              {photo && !isCameraActive && (
                <div className="mt-2 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-900/30 flex flex-col items-center justify-center"
                  style={{ animation: 'fadeInUp 0.3s ease-out' }}>
                  {/* Gambar preview */}
                  <div className="relative rounded-2xl overflow-hidden shadow-md border border-slate-200 dark:border-slate-700 max-w-full max-h-[280px] flex justify-center bg-slate-100 dark:bg-slate-950">
                    <img
                      src={photo}
                      alt="Pratinjau Lampiran"
                      className="max-w-full max-h-[280px] object-contain cursor-pointer transition-transform duration-300 hover:scale-[1.01]"
                      onClick={() => setPhotoModalImg({ src: photo, title: 'Pratinjau Foto Lampiran' })}
                    />
                  </div>

                  {/* Tombol aksi di bawah foto */}
                  <div className="flex justify-center gap-3 mt-4 w-full max-w-xs">
                    <button
                      type="button"
                      onClick={() => setPhotoModalImg({ src: photo, title: 'Pratinjau Foto Lampiran' })}
                      className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-slate-200/40 dark:border-slate-700/40 cursor-pointer"
                    >
                      <ZoomIn className="w-4 h-4" /> Lihat Detail
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPhoto(null); setPhotoInfo(''); }}
                      className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-rose-100 dark:border-rose-950/30 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" /> Hapus Foto
                    </button>
                  </div>

                  {/* Info ukuran */}
                  <div className="mt-4 flex flex-col items-center text-center gap-1.5">
                    <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/20 text-xs font-bold">
                      <CheckCircle className="w-3.5 h-3.5" /> Foto Berhasil Diproses
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{photoInfo}</span>
                  </div>
                </div>
              )}

              {/* Hidden inputs */}
              <input
                type="file"
                ref={cameraInputRef}
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoChange}
              />
              <input
                type="file"
                ref={galleryInputRef}
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />

              <style>{`
                @keyframes shimmer {
                  0% { background-position: -200% 0; }
                  100% { background-position: 200% 0; }
                }
                @keyframes fadeInUp {
                  from { opacity: 0; transform: translateY(8px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
            </div>

            {/* Aksi: Akhiri & Lanjutkan — Lanjutkan di kiri, Akhiri di kanan */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-orange-200/50 dark:border-orange-900/30">
              <button
                onClick={handleAkhiriDanLanjutkan}
                disabled={loadingAkhiriLanjut || loadingAkhiri || isPhotoLoading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3.5 px-4 rounded-xl shadow-[0_4px_12px_rgba(5,150,105,0.2)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                type="button"
                title="Akhiri aktivitas ini lalu lanjutkan dengan tugas yang sama"
              >
                {loadingAkhiriLanjut ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Play className="w-5 h-5 fill-current" />
                )}
                {loadingAkhiriLanjut ? 'Memproses...' : 'Akhiri & Lanjutkan'}
              </button>

              <button
                onClick={handleAkhiriAktivitas}
                disabled={loadingAkhiri || loadingAkhiriLanjut || isPhotoLoading}
                className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white font-bold py-3.5 px-4 rounded-xl shadow-[0_4px_12px_rgba(234,88,12,0.2)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
              >
                {loadingAkhiri ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckCircle className="w-5 h-5" />
                )}
                {loadingAkhiri ? 'Menyimpan...' : 'Akhiri Aktivitas'}
              </button>
            </div>
          </div>
        )}

        {/* ============================================================
            TAMPILAN 2: Tidak ada aktivitas → Form Input Baru
        ============================================================ */}
        {!checkingStatus && hasChecked && !ongoingTask && (
          <form onSubmit={handleMulaiAktivitas} className="space-y-5">

            <div className="flex items-center gap-2 mb-1">
              <Plus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Input Aktivitas Baru</h4>
            </div>

            {/* Pilih Jenis: TUPOKSI / NON TUPOKSI */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Jenis Aktivitas
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setJenis('TUPOKSI'); setIdTupoksi(''); setNamaTupoksiTerpilih(''); }}
                  className={`py-2.5 px-4 rounded-xl font-semibold text-sm transition-all border cursor-pointer ${
                    jenis === 'TUPOKSI'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-400 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  Tupoksi
                </button>
                <button
                  type="button"
                  onClick={() => { setJenis('NON_TUPOKSI'); setIdTupoksi(''); setNamaTupoksiTerpilih(''); }}
                  className={`py-2.5 px-4 rounded-xl font-semibold text-sm transition-all border cursor-pointer ${
                    jenis === 'NON_TUPOKSI'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-400 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  Non Tupoksi
                </button>
              </div>
            </div>

            {/* Pilih Tupoksi dari modal */}
            {jenis === 'TUPOKSI' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                  Pilih Tupoksi
                </label>
                <button
                  type="button"
                  onClick={() => setShowTupoksiModal(true)}
                  className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-600 text-slate-800 dark:text-slate-200 rounded-xl p-3.5 outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm text-left flex justify-between items-center gap-2 cursor-pointer"
                >
                  <span className={`truncate ${!idTupoksi ? 'text-slate-400' : ''}`}>
                    {idTupoksi ? namaTupoksiTerpilih || 'Tupoksi Terpilih' : '-- Pilih Tupoksi --'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              </div>
            )}

            {/* Nama tugas Non Tupoksi */}
            {jenis === 'NON_TUPOKSI' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                  Nama Tugas
                </label>
                <input
                  type="text"
                  value={tugasNonTupoksi}
                  onChange={(e) => setTugasNonTupoksi(e.target.value)}
                  placeholder="Contoh: Rapat koordinasi lintas seksi..."
                  className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 text-slate-800 dark:text-slate-200 rounded-xl p-3.5 outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm"
                />
              </div>
            )}

            {/* Keterangan / Uraian */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Keterangan / Uraian Kegiatan
              </label>
              <textarea
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Jelaskan detail kegiatan yang akan dilakukan..."
                rows={4}
                className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 text-slate-800 dark:text-slate-200 rounded-xl p-3.5 outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm resize-none custom-scrollbar"
              />
            </div>

            <button
              type="submit"
              disabled={loadingMulai}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3.5 px-4 rounded-xl shadow-[0_4px_12px_rgba(5,150,105,0.2)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              {loadingMulai ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save className="w-5 h-5" />
              )}
              {loadingMulai ? 'Menyimpan...' : 'Mulai Aktivitas'}
            </button>
          </form>
        )}

        {/* Dev Log */}
        {developerMode && devLog && (
          <DevLogSection
            title="Log Data Aktivitas"
            filename="input_aktivitas_log.txt"
            request={devLog.request}
            response={devLog.response}
          />
        )}

      </div>

      {/* ============================================================
          MODAL: Pilih Tupoksi
      ============================================================ */}
      {showTupoksiModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

            {/* Header modal */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
              <h4 className="font-bold text-lg text-slate-800 dark:text-white">Pilih Tupoksi</h4>
              <button
                onClick={() => { setShowTupoksiModal(false); setSearchTupoksi(''); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-700/40">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari tupoksi..."
                  value={searchTupoksi}
                  onChange={(e) => setSearchTupoksi(e.target.value)}
                  autoFocus
                  className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 dark:text-slate-200 transition-all"
                />
              </div>
            </div>

            {/* List tupoksi */}
            <div className="overflow-y-auto flex-1 custom-scrollbar">
              {tupoksiList.filter((item) => {
                const text = (item.nama_tupoksi || item.tugas || item.nama_tugas || item.aktifitas || '').toLowerCase();
                return text.includes(searchTupoksi.toLowerCase());
              }).length === 0 ? (
                <div className="p-12 flex flex-col items-center justify-center text-center">
                  <Activity className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-3" />
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    {tupoksiList.length === 0 ? 'Data tupoksi tidak tersedia.' : 'Tidak ditemukan hasil pencarian.'}
                  </p>
                </div>
              ) : (
                tupoksiList
                  .filter((item) => {
                    const text = (item.nama_tupoksi || item.tugas || item.nama_tugas || item.aktifitas || '').toLowerCase();
                    return text.includes(searchTupoksi.toLowerCase());
                  })
                  .map((item, i) => {
                    const idVal = item.id_tupoksi || item.id_aktifitas || item.id;
                    const namaVal = item.nama_tupoksi || item.tugas || item.nama_tugas || item.aktifitas || item.jenis || '—';
                    const isSelected = idVal === idTupoksi;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setIdTupoksi(idVal);
                          setNamaTupoksiTerpilih(namaVal);
                          setShowTupoksiModal(false);
                          setSearchTupoksi('');
                        }}
                        className={`w-full text-left px-5 py-4 transition-colors flex items-start gap-3 border-b border-slate-100 dark:border-slate-700/40 last:border-0 cursor-pointer group ${
                          isSelected
                            ? 'bg-emerald-50 dark:bg-emerald-900/20'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                        }`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full mt-1.5 shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-emerald-500'
                              : 'bg-slate-300 dark:bg-slate-600 group-hover:bg-emerald-400'
                          }`}
                        />
                        <p
                          className={`text-sm leading-relaxed ${
                            isSelected
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white'
                          }`}
                        >
                          {namaVal}
                        </p>
                      </button>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Lightbox pratinjau foto lampiran */}
    {photoModalImg && (
      <ImageLightbox
        src={photoModalImg.src}
        title={photoModalImg.title}
        onClose={() => setPhotoModalImg(null)}
      />
    )}
    </>
  );
}
