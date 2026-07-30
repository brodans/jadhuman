// ============================================================
//  src/lib/qstashService.ts
//  Client-side service untuk memanggil QStash API endpoints
//  Support reminder Produktivitas (2 jam)
// ============================================================

/** Key localStorage untuk menyimpan QStash messageId per userId */
const QSTASH_STORAGE_KEY = 'jadhuman_qstash_jobs';

interface QStashJob {
  messageId: string;
  userId: string;
  idPegawai?: string;
  taskId?: string;
  type?: string;
  scheduledAt: string;
  willTriggerAt: string;
}

// ── Storage Helpers ──────────────────────────────────────────────────────────
function saveJob(userId: string, job: QStashJob): void {
  try {
    const all = JSON.parse(localStorage.getItem(QSTASH_STORAGE_KEY) || '{}');
    all[userId] = job;
    localStorage.setItem(QSTASH_STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.error('[QStash Client] Error menyimpan job:', err);
  }
}

function getJob(userId: string): QStashJob | null {
  try {
    const all = JSON.parse(localStorage.getItem(QSTASH_STORAGE_KEY) || '{}');
    return all[userId] ?? null;
  } catch {
    return null;
  }
}

function removeJob(userId: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(QSTASH_STORAGE_KEY) || '{}');
    delete all[userId];
    localStorage.setItem(QSTASH_STORAGE_KEY, JSON.stringify(all));
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

// ─── Reminder Produktivitas ──────────────────────────────────────────────────
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


