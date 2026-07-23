// api/init-test.ts
import { getAccessToken, getProjectId, firestoreGet, parseDevices } from './_firebase-rest.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const steps: string[] = [];
  try {
    steps.push('1_get_project_id');
    const projectId = getProjectId();
    steps.push('2_project_id=' + projectId);

    steps.push('3_get_access_token');
    const token = await getAccessToken();
    steps.push('4_token_ok len=' + token.length);

    steps.push('5_read_firestore');
    const doc = await firestoreGet(projectId, 'jadhuman_fcm_tokens/default_admin', token);
    steps.push('6_firestore_ok exists=' + !!doc);

    if (doc) {
      const devices = parseDevices(doc);
      steps.push('7_devices_count=' + devices.length);
      steps.push('8_devices=' + devices.map(d => d.deviceInfo).join(' | '));
    }

    return res.status(200).json({ success: true, steps });
  } catch (err: any) {
    return res.status(500).json({ success: false, steps, error: err.message });
  }
}
