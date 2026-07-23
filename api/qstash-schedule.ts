// ============================================================
//  api/qstash-schedule.ts
//  Vercel Serverless Function
//  Endpoint untuk schedule dan cancel QStash job
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from '@upstash/qstash';

// Init QStash Client
function getQStashClient() {
  const token = process.env.QSTASH_TOKEN;
  
  if (!token) {
    throw new Error('QSTASH_TOKEN tidak ditemukan di environment variables');
  }

  return new Client({ token });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    return handleSchedule(req, res);
  }

  if (req.method === 'DELETE') {
    return handleCancel(req, res);
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

/**
 * Schedule QStash job.
 * delay dihitung dari client (sisa waktu menuju 2 jam dari tgl_mulai).
 * Jika delay <= 0 maka aktivitas sudah >2 jam → kirim segera (delay 5s).
 * Jika delay tidak dikirim, default 7200s.
 */
async function handleSchedule(req: VercelRequest, res: VercelResponse) {
  try {
    const { userId, userName, idPegawai, taskId, tglMulai, delaySeconds } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, error: 'userId diperlukan' });
    }

    const qstash = getQStashClient();
    const TWO_HOURS = 2 * 60 * 60;

    // Hitung delay:
    // - Jika client kirim delaySeconds → pakai itu
    // - Jika tidak → hitung dari tglMulai
    // - Jika sudah >2 jam → kirim segera (5 detik)
    let delay: number;
    if (typeof delaySeconds === 'number') {
      delay = delaySeconds > 0 ? delaySeconds : 5;
    } else if (tglMulai) {
      const elapsed = Math.floor((Date.now() - new Date(tglMulai).getTime()) / 1000);
      const remaining = TWO_HOURS - elapsed;
      delay = remaining > 0 ? remaining : 5;
    } else {
      delay = TWO_HOURS;
    }

    const webhookUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/qstash-webhook`
      : process.env.QSTASH_WEBHOOK_URL || 'https://jadhuman.vercel.app/api/qstash-webhook';

    console.log(`[QStash] Scheduling untuk userId: ${userId}, delay: ${delay}s (~${Math.round(delay/60)}m)`);

    const response = await qstash.publishJSON({
      url: webhookUrl,
      body: {
        userId,
        userName:  userName  || 'User',
        idPegawai: idPegawai || '',
        taskId:    taskId    || '',
        tglMulai:  tglMulai  || new Date().toISOString(),
        ...req.body,
      },
      delay,
      retries: 2,
    });

    const messageId = response.messageId;

    console.log(`[QStash Schedule] Job terjadwal dengan messageId: ${messageId}`);

    return res.status(200).json({
      success: true,
      message: 'QStash job berhasil dijadwalkan',
      messageId,
      delaySeconds: delay,
      webhookUrl,
      scheduledAt: new Date().toISOString(),
      willTriggerAt: new Date(Date.now() + delay * 1000).toISOString(),
    });

  } catch (err: any) {
    console.error('[QStash Schedule] Error:', err);
    return res.status(500).json({
      success: false,
      error: 'Gagal schedule QStash job',
      details: err.message,
    });
  }
}

/**
 * Cancel QStash job berdasarkan messageId
 */
async function handleCancel(req: VercelRequest, res: VercelResponse) {
  try {
    const { messageId } = req.body;

    // Validasi input
    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'messageId diperlukan untuk cancel job' 
      });
    }

    const qstash = getQStashClient();

    console.log(`[QStash Schedule] Canceling job dengan messageId: ${messageId}`);

    // Cancel job di QStash
    await qstash.messages.delete(messageId);

    console.log(`[QStash Schedule] Job berhasil dibatalkan: ${messageId}`);

    return res.status(200).json({
      success: true,
      message: 'QStash job berhasil dibatalkan',
      messageId,
      canceledAt: new Date().toISOString(),
    });

  } catch (err: any) {
    console.error('[QStash Schedule] Error cancel:', err);
    
    // Jika message sudah tidak ada (sudah trigger atau expired), anggap success
    if (err.message?.includes('not found') || err.message?.includes('404')) {
      return res.status(200).json({
        success: true,
        message: 'Job sudah tidak ada (mungkin sudah trigger atau expired)',
        messageId: req.body.messageId,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Gagal cancel QStash job',
      details: err.message,
    });
  }
}
