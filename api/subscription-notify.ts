// ============================================================
//  api/subscription-notify.ts
//  Midtrans payment notification webhook untuk subscription jadhuman.
//  POST dari Midtrans setelah transaksi berhasil/gagal.
// ============================================================

import { createHash } from 'crypto';
import { getAccessToken, getProjectId, firestorePatch } from './_firebase-rest.js';

const COLLECTION = 'jadhuman_subscriptions';

/** Verifikasi signature Midtrans: SHA512(order_id + status_code + gross_amount + server_key) */
function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
  signatureKey: string
): boolean {
  const expected = createHash('sha512')
    .update(orderId + statusCode + grossAmount + serverKey)
    .digest('hex');
  return expected === signatureKey;
}

/** Ekstrak user_id dari order_id format: sub-{user_id}-{shortTs} atau legacy jadhuman-sub-{user_id}-{timestamp} */
function extractUserId(orderId: string): string | null {
  const match = orderId.match(/^(?:jadhuman-)?sub-(.+)-[a-z0-9]+$/i);
  return match ? match[1] : null;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    return res.status(500).json({ error: 'MIDTRANS_SERVER_KEY tidak ditemukan' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};

    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
    } = body;

    if (!order_id || !signature_key) {
      return res.status(400).json({ error: 'Payload tidak lengkap' });
    }

    // ── Verifikasi signature ──────────────────────────────────────────────
    const valid = verifyMidtransSignature(
      order_id, status_code, gross_amount, serverKey, signature_key
    );
    if (!valid) {
      console.error('[subscription-notify] Invalid signature for order:', order_id);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // ── Ekstrak userId dari order_id ──────────────────────────────────────
    const userId = extractUserId(order_id);
    if (!userId) {
      console.warn('[subscription-notify] Tidak bisa parse user_id dari order_id:', order_id);
      return res.status(200).json({ message: 'Order ID tidak dikenal, diabaikan' });
    }

    console.log(`[subscription-notify] order=${order_id} status=${transaction_status} user=${userId}`);

    const projectId   = getProjectId();
    const accessToken = await getAccessToken();
    const now         = new Date().toISOString();

    const isSuccess =
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept');

    const isFailure =
      transaction_status === 'deny'   ||
      transaction_status === 'cancel' ||
      transaction_status === 'expire';

    if (isSuccess) {
      // Hitung expires_at +30 hari untuk monthly
      // (billing_type perlu dibaca dulu, tapi kita baca dari Firestore bisa mahal,
      //  jadi kita set expires_at +30 hari selalu — kalau one_time biarkan admin reset manual)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await firestorePatch(
        projectId,
        `${COLLECTION}/${userId}`,
        {
          status:             { stringValue: 'active' },
          paid_at:            { timestampValue: now },
          expires_at:         { timestampValue: expiresAt },
          midtrans_order_id:  { stringValue: order_id },
          updated_at:         { timestampValue: now },
        },
        ['status', 'paid_at', 'expires_at', 'midtrans_order_id', 'updated_at'],
        accessToken
      );
      console.log(`[subscription-notify] ✅ User ${userId} subscription diaktifkan s/d ${expiresAt}`);
    } else if (isFailure) {
      await firestorePatch(
        projectId,
        `${COLLECTION}/${userId}`,
        {
          status:     { stringValue: 'unpaid' },
          updated_at: { timestampValue: now },
        },
        ['status', 'updated_at'],
        accessToken
      );
      console.log(`[subscription-notify] ❌ User ${userId} transaksi ${transaction_status}`);
    } else {
      console.log(`[subscription-notify] Status ${transaction_status} diabaikan untuk user ${userId}`);
    }

    // Midtrans mengharapkan 200 agar tidak retry
    return res.status(200).json({ message: 'OK' });

  } catch (err: any) {
    console.error('[subscription-notify] Error:', err.message);
    // Tetap 200 agar Midtrans tidak spam retry
    return res.status(200).json({ message: 'Error handled', error: err.message });
  }
}
