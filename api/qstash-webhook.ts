// api/qstash-webhook.ts
// QStash webhook handler — menerima trigger dari QStash setelah delay
// dan kirim FCM notification ke semua device user yang terdaftar di Firestore.
import { Receiver, Client as QStashClient } from '@upstash/qstash';
import { getAccessToken, getProjectId, firestoreGet, firestorePatch, parseDevices, devicesToFirestore, sendFCMBatch, parseNotifSettings } from './_firebase-rest.js';

// ─── Verify QStash signature ─────────────────────────────────────────────────
function verifySignature(req: any): boolean {
  const cur = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nxt = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!cur || !nxt) {
    console.warn('[Webhook] QSTASH signing keys tidak di-set, skip verification (dev mode)');
    return true;
  }

  try {
    const sig = req.headers['upstash-signature'] as string;
    if (!sig) {
      console.error('[Webhook] Missing upstash-signature header');
      return false;
    }

    const bodyStr = typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body);

    new Receiver({ currentSigningKey: cur, nextSigningKey: nxt })
      .verify({ signature: sig, body: bodyStr });

    return true;
  } catch (err: any) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return false;
  }
}

// ─── Server-side Helper: Hitung Presensi Berikutnya ─────────────────────────
function calculateNextPresensiTargetServer(config: any, fromDate: Date = new Date()) {
  if (!config || !config.enabled) return null;
  const nowMs = fromDate.getTime();
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  for (let offset = 0; offset <= 7; offset++) {
    const candidateDay = new Date(fromDate);
    candidateDay.setDate(candidateDay.getDate() + offset);
    const dayOfWeek = candidateDay.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const isFriday = dayOfWeek === 5;
    const masukTime = isFriday ? (config.jumatMasuk || '07:00') : (config.seninKamisMasuk || '07:30');
    const pulangTime = isFriday ? (config.jumatPulang || '11:30') : (config.seninKamisPulang || '15:45');

    const parseTime = (timeStr: string): Date => {
      const [h, m] = (timeStr || '07:00').split(':').map((n: string) => parseInt(n, 10) || 0);
      const d = new Date(candidateDay);
      d.setHours(h, m, 0, 0);
      return d;
    };

    const masukDate = parseTime(masukTime);
    const pulangDate = parseTime(pulangTime);

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

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Upstash-Signature');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!verifySignature(req)) {
      return res.status(401).json({ success: false, error: 'Invalid QStash signature' });
    }

    const payload = typeof req.body === 'string'
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body ?? {});

    const { userId, userName, idPegawai, taskId, tglMulai, type, presensiType, presensiTime, dayName, presensiConfig } = payload;

    if (!userId) {
      console.error('[Webhook] userId tidak ada di payload');
      return res.status(400).json({ success: false, error: 'userId diperlukan' });
    }

    console.log(`[Webhook] Menerima job type=${type || 'productivity'} untuk userId=${userId}`);

    const projectId   = getProjectId();
    const accessToken = await getAccessToken();

    const doc = await firestoreGet(projectId, `jadhuman_fcm_tokens/${userId}`, accessToken);

    if (!doc) {
      console.log(`[Webhook] User document tidak ada untuk userId=${userId}`);
      return res.status(200).json({ success: true, message: 'User document tidak ada di Firestore', sent: 0, userId });
    }

    const devices = parseDevices(doc);
    const tokens  = devices.map(d => d.token).filter(Boolean);

    if (tokens.length === 0) {
      console.log(`[Webhook] Tidak ada device terdaftar untuk userId=${userId}`);
      return res.status(200).json({ success: true, message: 'Tidak ada device terdaftar', sent: 0, userId });
    }

    // ── Build pesan notifikasi berdasarkan jenis reminder ─────────────────────
    const displayName = userName || 'Anda';
    let title = '⏰ Pengingat Produktivitas';
    let body  = `${displayName} telah bekerja 2 jam! Segera akhiri sesi.`;
    let tag   = 'productivity-2hr';
    let targetUrl = '/input-aktivitas';

    if (type === 'presensi_reminder') {
      const isCheckin = presensiType === 'checkin';
      const timeLabel = presensiTime || '';
      const dName     = dayName || '';
      tag = `presensi-${presensiType || 'reminder'}`;
      targetUrl = '/';

      if (isCheckin) {
        title = '⏰ Pengingat Presensi Masuk';
        body  = `Halo ${displayName}, saatnya melakukan Presensi Masuk (${dName ? dName + ' ' : ''}${timeLabel})! Silakan buka aplikasi.`;
      } else {
        title = '⏰ Pengingat Presensi Pulang';
        body  = `Halo ${displayName}, saatnya melakukan Presensi Pulang (${dName ? dName + ' ' : ''}${timeLabel})! Hati-hati di jalan.`;
      }
    } else {
      const tglFormatted = tglMulai
        ? (() => {
            try {
              return new Date(tglMulai).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              });
            } catch { return tglMulai; }
          })()
        : 'N/A';
      body = `${displayName} telah bekerja 2 jam! (Mulai: ${tglFormatted}). Segera akhiri sesi.`;
    }

    const data: Record<string, string> = {
      type:       type || 'productivity_reminder',
      userId,
      idPegawai:  idPegawai  || '',
      taskId:     taskId     || '',
      tglMulai:   tglMulai   || '',
      timestamp:  new Date().toISOString(),
      tag,
      targetUrl,
    };

    console.log(`[Webhook] Kirim FCM batch to ${tokens.length} devices. Title: "${title}"`);

    // ── Kirim FCM batch ───────────────────────────────────────────────────────
    const results = await sendFCMBatch(projectId, accessToken, tokens, title, body, data, tag);

    const failedTokens: string[] = [];
    let successCount = 0;

    results.forEach((r, idx) => {
      const info = devices[idx]?.deviceInfo || `Device ${idx + 1}`;
      if (r.success) {
        successCount++;
        console.log(`[Webhook] ✅ Berhasil → ${info}`);
      } else {
        console.log(`[Webhook] ❌ Gagal → ${info}: ${r.error}`);
        const isInvalidToken = r.error === 'UNREGISTERED'
          || r.error === 'INVALID_ARGUMENT'
          || r.error === 'SENDER_ID_MISMATCH'
          || r.error === 'NOT_FOUND'
          || (r.error || '').includes('UNREGISTERED')
          || (r.error || '').includes('INVALID_ARGUMENT');
        if (isInvalidToken) {
          failedTokens.push(tokens[idx]);
        }
      }
    });

    if (failedTokens.length > 0) {
      try {
        const cleanedDevices = devices.filter(d => !failedTokens.includes(d.token));
        await firestorePatch(
          projectId,
          `jadhuman_fcm_tokens/${userId}`,
          { devices: devicesToFirestore(cleanedDevices) },
          ['devices'],
          accessToken
        );
      } catch (cleanupErr: any) {
        console.warn('[Webhook] Cleanup token failed:', cleanupErr.message);
      }
    }

    // ── Auto-schedule target presensi berikutnya ──────────────────────────────
    if (type === 'presensi_reminder') {
      try {
        let activeConfig = presensiConfig;

        // Ambil config terbaru dari Firebase Firestore jika ada
        try {
          const notifDoc = await firestoreGet(projectId, `jadhuman_notif_settings/${userId}`, accessToken);
          const parsed = parseNotifSettings(notifDoc);
          if (parsed?.presensiConfig) {
            activeConfig = parsed.presensiConfig;
          }
        } catch (fErr: any) {
          console.warn('[Webhook] Gagal fetch notif settings dari Firestore:', fErr.message);
        }

        if (activeConfig && activeConfig.enabled) {
          const nextTarget = calculateNextPresensiTargetServer(activeConfig, new Date());
          const qstashToken = process.env.QSTASH_TOKEN;
          if (nextTarget && qstashToken) {
            const qstash = new QStashClient({ token: qstashToken });
            const webhookUrl = process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}/api/qstash-webhook`
              : process.env.QSTASH_WEBHOOK_URL || 'https://jadhuman.vercel.app/api/qstash-webhook';

            await qstash.publishJSON({
              url: webhookUrl,
              body: {
                ...payload,
                presensiConfig: activeConfig,
                presensiType: nextTarget.presensiType,
                presensiTime: nextTarget.presensiTime,
                dayName: nextTarget.dayName,
                delaySeconds: nextTarget.delaySeconds,
              },
              delay: nextTarget.delaySeconds,
              retries: 2,
            });
            console.log(`[Webhook] Presensi berikutnya berhasil dijadwalkan: ${nextTarget.presensiType} (${nextTarget.dayName} ${nextTarget.presensiTime}) delay ${nextTarget.delaySeconds}s`);
          }
        }
      } catch (reErr: any) {
        console.warn('[Webhook] Auto-schedule presensi berikutnya gagal:', reErr.message);
      }
    }

    return res.status(200).json({
      success: successCount > 0,
      sent: successCount,
      failed: tokens.length - successCount,
      totalDevices: tokens.length,
      userId,
      sentAt: new Date().toISOString(),
    });

  } catch (err: any) {
    console.error('[Webhook] Unexpected error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
