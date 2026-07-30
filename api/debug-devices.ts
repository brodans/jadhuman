// api/debug-devices.ts
import { getAccessToken, getProjectId, firestoreGet, parseDevices } from './_firebase-rest.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const projectId   = getProjectId();
    const accessToken = await getAccessToken();
    const userId      = (req.query.userId as string) || 'default_admin';
    const doc         = await firestoreGet(projectId, `jadhuman_fcm_tokens/${userId}`, accessToken);
    if (!doc) return res.status(200).json({ exists: false, userId, devices: [], deviceCount: 0 });
    const devices = parseDevices(doc);
    // Return token ASLI agar client bisa pakai untuk hapus
    return res.status(200).json({
      exists:      true,
      userId,
      deviceCount: devices.length,
      devices,
      rootFields:  Object.keys(doc.fields || {}).filter((k: string) => k !== 'devices'),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
