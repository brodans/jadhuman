// api/test-notification.ts
import { getAccessToken, getProjectId, firestoreGet, firestorePatch, parseDevices, devicesToFirestore, sendFCMBatch } from './_firebase-rest.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, userName, testType } = req.body ?? {};
    if (!userId) return res.status(400).json({ success: false, error: 'userId diperlukan' });

    const projectId   = getProjectId();
    const accessToken = await getAccessToken();

    const doc = await firestoreGet(projectId, `jadhuman_fcm_tokens/${userId}`, accessToken);
    if (!doc) return res.status(404).json({ success: false, error: 'Device belum terdaftar', userId });

    const devices = parseDevices(doc);
    const tokens  = devices.map(d => d.token).filter(Boolean);
    if (tokens.length === 0)
      return res.status(404).json({ success: false, error: 'Tidak ada device terdaftar', userId });

    const now         = new Date();
    const displayName = userName || userId;
    const isPresensi  = testType === 'presensi';

    let title     = '⏰ Pengingat Produktivitas [TEST]';
    let body      = '';
    let tag       = 'productivity-test';
    let targetUrl = '/input-aktivitas';
    let type      = 'productivity_reminder';

    if (isPresensi) {
      title     = '⏰ Pengingat Presensi [TEST]';
      body      = `Halo ${displayName}, ini tes notifikasi Presensi Masuk! Klik notifikasi ini untuk membuka halaman Submit Presensi.`;
      tag       = 'presensi-test';
      targetUrl = '/submit-presensi';
      type      = 'presensi_reminder';
    } else {
      const twoHrsAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const formatted = twoHrsAgo.toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      body = `${displayName} telah bekerja 2 jam! (Mulai: ${formatted}). Segera akhiri sesi.`;
    }

    const data = {
      type, userId,
      taskId: 'test_' + now.getTime(),
      timestamp: now.toISOString(),
      tag, testMode: 'true',
      targetUrl,
    };

    console.log(`[Test ${testType || 'productivity'}] userId=${userId} devices=${tokens.length}:`, devices.map(d => d.deviceInfo));
    const results = await sendFCMBatch(projectId, accessToken, tokens, title, body, data, tag);

    const deviceResults: any[] = [];
    const failedTokens: string[] = [];
    let successCount = 0;

    results.forEach((r, idx) => {
      const info = devices[idx]?.deviceInfo || 'Unknown';
      if (r.success) {
        successCount++;
        console.log(`[Test] ✅ ${info}`);
        deviceResults.push({ device: info, success: true });
      } else {
        console.log(`[Test] ❌ ${info}: ${r.error}`, r.rawError || '');
        deviceResults.push({ device: info, success: false, error: r.error, rawError: r.rawError });
        if (r.error === 'UNREGISTERED' || r.error === 'INVALID_ARGUMENT' || r.error === 'NOT_FOUND')
          failedTokens.push(tokens[idx]);
      }
    });

    if (failedTokens.length > 0) {
      const cleaned = devices.filter(d => !failedTokens.includes(d.token));
      await firestorePatch(projectId, `jadhuman_fcm_tokens/${userId}`,
        { devices: devicesToFirestore(cleaned) }, ['devices'], accessToken);
    }

    return res.status(200).json({
      success: successCount > 0,
      multicast: { successCount, failureCount: tokens.length - successCount, totalDevices: tokens.length, cleanedUpTokens: failedTokens.length },
      deviceResults,
      userId,
      testType: isPresensi ? 'presensi' : 'productivity',
      sentAt: now.toISOString(),
    });
  } catch (err: any) {
    console.error('[Test] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
