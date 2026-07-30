// api/qstash-webhook.ts
// QStash webhook handler — menerima trigger dari QStash setelah delay
// dan kirim FCM notification ke semua device user yang terdaftar di Firestore.
import { Receiver } from '@upstash/qstash';
import { getAccessToken, getProjectId, firestoreGet, firestorePatch, parseDevices, devicesToFirestore, sendFCMBatch } from './_firebase-rest.js';

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

    const { userId, userName, idPegawai, taskId, tglMulai } = payload;

    if (!userId) {
      console.error('[Webhook] userId tidak ada di payload');
      return res.status(400).json({ success: false, error: 'userId diperlukan' });
    }

    console.log(`[Webhook] Menerima job productivity_reminder untuk userId=${userId}`);

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

    // ── Build pesan notifikasi Produktivitas ──────────────────────────────────
    const displayName = userName || 'Anda';
    const title = '⏰ Pengingat Produktivitas';
    const tag   = 'productivity-2hr';

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

    const body = `${displayName} telah bekerja 2 jam! (Mulai: ${tglFormatted}). Segera akhiri sesi.`;

    const data: Record<string, string> = {
      type:       'productivity_reminder',
      userId,
      idPegawai:  idPegawai  || '',
      taskId:     taskId     || '',
      tglMulai:   tglMulai   || '',
      timestamp:  new Date().toISOString(),
      tag,
      targetUrl:  '/input-aktivitas',
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
