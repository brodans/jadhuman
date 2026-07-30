// ============================================================
//  api/subscription-create.ts
//  Vercel serverless — buat Midtrans Snap token untuk subscription.
//  POST { user_id, username }
//  Return { snap_token, redirect_url, order_id }
// ============================================================

import { getAccessToken, getProjectId, firestoreGet, firestorePatch } from './_firebase-rest.js';

const COLLECTION = 'jadhuman_subscriptions';
const DEFAULT_AMOUNT = 50000;

/** Baca field sederhana dari Firestore REST doc */
function parseSubDoc(doc: any): {
  amount: number; billing_type: string; payment_enabled: boolean;
} {
  if (!doc?.fields) return { amount: DEFAULT_AMOUNT, billing_type: 'monthly', payment_enabled: true };
  const f = doc.fields;
  return {
    amount:          f.amount?.integerValue        ? parseInt(f.amount.integerValue, 10)    : DEFAULT_AMOUNT,
    billing_type:    f.billing_type?.stringValue   ?? 'monthly',
    payment_enabled: f.payment_enabled?.booleanValue ?? true,
  };
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

  const { user_id, username } = req.body ?? {};
  if (!user_id) return res.status(400).json({ error: 'user_id diperlukan' });

  try {
    const projectId   = getProjectId();
    const accessToken = await getAccessToken();

    // ── Baca subscription user untuk dapat amount ─────────────────────────
    const subDoc   = await firestoreGet(projectId, `${COLLECTION}/${user_id}`, accessToken);
    const subData  = parseSubDoc(subDoc);
    const amount   = subData.amount || DEFAULT_AMOUNT;

    // ── Buat order_id unik (< 50 karakter sesuai limit Midtrans) ─────────
    const shortTs = Date.now().toString(36);
    const prefix = 'sub-';
    const maxUserLen = 50 - prefix.length - 1 - shortTs.length; // ~37 karakter
    const safeUserId = user_id.length > maxUserLen ? user_id.slice(0, maxUserLen) : user_id;
    const orderId = `${prefix}${safeUserId}-${shortTs}`;

    // ── Hit Midtrans Snap API ─────────────────────────────────────────────
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const snapUrl = isProduction
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const authString = Buffer.from(`${serverKey}:`).toString('base64');

    const snapRes = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        'Accept':        'application/json',
        'Content-Type':  'application/json',
        'Authorization': `Basic ${authString}`,
      },
      body: JSON.stringify({
        transaction_details: {
          order_id:     orderId,
          gross_amount: amount,
        },
        credit_card: { secure: true },
        customer_details: {
          first_name: username || user_id,
          email:      `${user_id}@jadhuman.app`,
        },
        item_details: [{
          id:       'subscription',
          price:    amount,
          quantity: 1,
          name:     `Langganan Jadhuman${subData.billing_type === 'monthly' ? ' (Bulanan)' : ''}`,
        }],
        callbacks: {
          finish: `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://jadhuman.vercel.app'}/`,
        },
      }),
    });

    const snapData = await snapRes.json() as any;
    if (!snapRes.ok) {
      console.error('[subscription-create] Midtrans error:', snapData);
      return res.status(snapRes.status).json({
        error: snapData.error_messages?.[0] || `Midtrans error ${snapRes.status}`,
      });
    }

    // ── Simpan snap_token + order_id ke Firestore ─────────────────────────
    await firestorePatch(
      projectId,
      `${COLLECTION}/${user_id}`,
      {
        midtrans_order_id:   { stringValue: orderId },
        midtrans_snap_token: { stringValue: snapData.token || '' },
        updated_at:          { timestampValue: new Date().toISOString() },
      },
      ['midtrans_order_id', 'midtrans_snap_token', 'updated_at'],
      accessToken
    );

    return res.status(200).json({
      snap_token:   snapData.token,
      redirect_url: snapData.redirect_url,
      order_id:     orderId,
    });

  } catch (err: any) {
    console.error('[subscription-create] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
