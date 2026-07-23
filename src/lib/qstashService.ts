// ============================================================
//  src/lib/qstashService.ts
//  Client-side service untuk memanggil QStash API endpoints
//  Support 2 jenis reminder: Produktivitas & Presensi (Jam Masuk/Pulang)
// ============================================================

/** Key localStorage untuk menyimpan QStash messageId per userId */
const QSTASH_STORAGE_KEY = 'jadhuman_qstash_jobs';
const QSTASH_PRESENSI_STORAGE_KEY = 'jadhuman_qstash_presensi_jobs';
const PRESENSI_CONFIG_KEY = (userId: string) => `jadhuman_presensi_config_${userId}`;

export interface PresensiScheduleConfig {
  enabled: boolean;
  seninKamisMasuk: string;  // e.g. "07:30"
  seninKamisPulang: string; // e.g. "15:45"
  jumatMasuk: string;       // e.g. "07:00"
  jumatPulang: string;      // e.g. "11:30"
}

export function getDefaultPresensiConfig(): PresensiScheduleConfig {
  return {
    enabled: false,
    seninKamisMasuk: '07:30',
    seninKamisPulang: '15:45',
    jumatMasuk: '07:00',
    jumatPulang: '11:30',
  };
}

export function getPresensiConfig(userId: string): PresensiScheduleConfig {
  try {
    const raw = localStorage.getItem(PRESENSI_CONFIG_KEY(userId));
    if (!raw) return getDefaultPresensiConfig();
    return { ...getDefaultPresensiConfig(), ...JSON.parse(raw) };
  } catch {
    return getDefaultPresensiConfig();
  }
}

import { saveUserNotifSettings } from './notifSettingsService';

export function savePresensiConfig(userId: string, config: PresensiScheduleConfig): void {
  try {
    localStorage.setItem(PRESENSI_CONFIG_KEY(userId), JSON.stringify(config));
    // Save to Firebase Firestore per user
    saveUserNotifSettings(userId, { presensiConfig: config }).catch((err) => {
      console.error('[QStash Client] Error sync presensi config ke Firebase:', err);
    });
  } catch (err) {
    console.error('[QStash Client] Error simpan presensi config:', err);
  }
}

interface QStashJob {
  messageId: string;
  userId: string;
  idPegawai?: string;
  taskId?: string;
  type?: string;
  scheduledAt: string;
  willTriggerAt: string;
  presensiType?: 'checkin' | 'checkout';
  presensiTime?: string;
  dayName?: string;
}

// ── Storage Helpers ──────────────────────────────────────────────────────────
function saveJob(userId: string, job: QStashJob, storageKey = QSTASH_STORAGE_KEY): void {
  try {
    const all = JSON.parse(localStorage.getItem(storageKey) || '{}');
    all[userId] = job;
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch (err) {
    console.error('[QStash Client] Error menyimpan job:', err);
  }
}

function getJob(userId: string, storageKey = QSTASH_STORAGE_KEY): QStashJob | null {
  try {
    const all = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return all[userId] ?? null;
  } catch {
    return null;
  }
}

function removeJob(userId: string, storageKey = QSTASH_STORAGE_KEY): void {
  try {
    const all = JSON.parse(localStorage.getItem(storageKey) || '{}');
    delete all[userId];
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch (err) {
    console.error('[QStash Client] Error menghapus job:', err);
  }
}

// ── Internal Cancel Helper ───────────────────────────────────────────────────
async function cancelJobById(messageId: string): Promise<void> {
  try {
    const response = await fetch('/api/qstash-schedule', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });

    const data = await response.json();

    if (!data.success) {
      console.warn('[QStash Client] Cancel job server warning:', data.error);
    }
  } catch (err: any) {
    console.warn('[QStash Client] Error cancel job by ID:', err.message);
  }
}

// ─── 1. Reminder Produktivitas ───────────────────────────────────────────────
export async function scheduleProductivityNotification(params: {
  userId: string;
  userName: string;
  idPegawai: string;
  taskId?: string;
  tglMulai: string;
  delaySeconds?: number;
}): Promise<string | null> {
  const { userId, userName, idPegawai, taskId, tglMulai, delaySeconds } = params;

  try {
    const existingJob = getJob(userId);
    if (existingJob?.messageId) {
      console.log('[QStash Client] Cancel job produktivitas lama:', existingJob.messageId);
      await cancelJobById(existingJob.messageId);
      removeJob(userId);
    }

    const response = await fetch('/api/qstash-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'productivity_reminder',
        userId, userName, idPegawai,
        taskId: taskId || '',
        tglMulai,
        delaySeconds: delaySeconds ?? undefined,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const { messageId, willTriggerAt, scheduledAt } = data;
    saveJob(userId, { messageId, userId, idPegawai, taskId, type: 'productivity_reminder', scheduledAt, willTriggerAt });

    console.log(`[QStash Client] Job produktivitas dijadwalkan untuk userId ${userId}: ${messageId}`);
    return messageId;
  } catch (err: any) {
    console.error('[QStash Client] Gagal schedule job produktivitas:', err.message);
    return null;
  }
}

export async function cancelProductivityNotification(params: { userId: string }): Promise<boolean> {
  const { userId } = params;
  try {
    const job = getJob(userId);
    if (!job?.messageId) return true;

    await cancelJobById(job.messageId);
    removeJob(userId);
    return true;
  } catch (err: any) {
    console.error('[QStash Client] Error cancel produktivitas:', err.message);
    removeJob(userId);
    return false;
  }
}

// ─── 2. Reminder Presensi (Jam Masuk & Pulang) ──────────────────────────────
export function calculateNextPresensiTarget(
  config: PresensiScheduleConfig,
  fromDate: Date = new Date()
): {
  targetDate: Date;
  delaySeconds: number;
  presensiType: 'checkin' | 'checkout';
  presensiTime: string;
  dayName: string;
} | null {
  if (!config.enabled) return null;

  const nowMs = fromDate.getTime();
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  for (let offset = 0; offset <= 7; offset++) {
    const candidateDay = new Date(fromDate);
    candidateDay.setDate(candidateDay.getDate() + offset);
    const dayOfWeek = candidateDay.getDay(); // 0 = Minggu, 6 = Sabtu

    // Skip akhir pekan
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const isFriday = dayOfWeek === 5;
    const masukTime = isFriday ? config.jumatMasuk : config.seninKamisMasuk;
    const pulangTime = isFriday ? config.jumatPulang : config.seninKamisPulang;

    const parseTime = (timeStr: string): Date => {
      const [h, m] = (timeStr || '07:00').split(':').map(n => parseInt(n, 10) || 0);
      const d = new Date(candidateDay);
      d.setHours(h, m, 0, 0);
      return d;
    };

    const masukDate = parseTime(masukTime);
    const pulangDate = parseTime(pulangTime);

    // 1. Cek jam masuk
    if (masukDate.getTime() > nowMs + 10000) {
      const delay = Math.max(5, Math.floor((masukDate.getTime() - nowMs) / 1000));
      return {
        targetDate: masukDate,
        delaySeconds: delay,
        presensiType: 'checkin',
        presensiTime: masukTime,
        dayName: dayNames[dayOfWeek],
      };
    }

    // 2. Cek jam pulang
    if (pulangDate.getTime() > nowMs + 10000) {
      const delay = Math.max(5, Math.floor((pulangDate.getTime() - nowMs) / 1000));
      return {
        targetDate: pulangDate,
        delaySeconds: delay,
        presensiType: 'checkout',
        presensiTime: pulangTime,
        dayName: dayNames[dayOfWeek],
      };
    }
  }

  return null;
}

export async function schedulePresensiNotification(params: {
  userId: string;
  userName: string;
  config: PresensiScheduleConfig;
}): Promise<string | null> {
  const { userId, userName, config } = params;

  try {
    // 1. Cancel job presensi lama jika ada
    const existingJob = getJob(userId, QSTASH_PRESENSI_STORAGE_KEY);
    if (existingJob?.messageId) {
      console.log('[QStash Presensi] Cancel job presensi lama:', existingJob.messageId);
      await cancelJobById(existingJob.messageId);
      removeJob(userId, QSTASH_PRESENSI_STORAGE_KEY);
    }

    if (!config.enabled) {
      return null;
    }

    // 2. Hitung target berikutnya
    const target = calculateNextPresensiTarget(config);
    if (!target) {
      console.warn('[QStash Presensi] Tidak ada target presensi terhitung');
      return null;
    }

    console.log(`[QStash Presensi] Next Target: ${target.presensiType} (${target.dayName} ${target.presensiTime}) in ${target.delaySeconds}s`);

    const response = await fetch('/api/qstash-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'presensi_reminder',
        userId,
        userName,
        presensiType: target.presensiType,
        presensiTime: target.presensiTime,
        dayName: target.dayName,
        presensiConfig: config,
        delaySeconds: target.delaySeconds,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const { messageId, scheduledAt } = data;
    const jobInfo: QStashJob = {
      messageId,
      userId,
      type: 'presensi_reminder',
      scheduledAt,
      willTriggerAt: target.targetDate.toISOString(),
      presensiType: target.presensiType,
      presensiTime: target.presensiTime,
      dayName: target.dayName,
    };

    saveJob(userId, jobInfo, QSTASH_PRESENSI_STORAGE_KEY);
    console.log(`[QStash Presensi] Job presensi berhasil dijadwalkan ID: ${messageId}`);
    return messageId;

  } catch (err: any) {
    console.error('[QStash Presensi] Error schedule presensi notification:', err.message);
    return null;
  }
}

export async function cancelPresensiNotification(params: { userId: string }): Promise<boolean> {
  const { userId } = params;
  try {
    const job = getJob(userId, QSTASH_PRESENSI_STORAGE_KEY);
    if (!job?.messageId) return true;

    await cancelJobById(job.messageId);
    removeJob(userId, QSTASH_PRESENSI_STORAGE_KEY);
    return true;
  } catch (err: any) {
    console.error('[QStash Presensi] Error cancel presensi:', err.message);
    removeJob(userId, QSTASH_PRESENSI_STORAGE_KEY);
    return false;
  }
}

export function hasActiveJob(userId: string): boolean {
  return getJob(userId) !== null;
}

export function getActiveJobInfo(userId: string): QStashJob | null {
  return getJob(userId);
}

export function getPresensiJobInfo(userId: string): QStashJob | null {
  return getJob(userId, QSTASH_PRESENSI_STORAGE_KEY);
}
