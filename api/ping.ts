// api/ping.ts — minimal health check, no firebase
export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  let parsed: any = null;
  let parseError  = '';

  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    parseError = e.message;
  }

  return res.status(200).json({
    ok:              true,
    nodeVersion:     process.version,
    hasServiceAcct:  raw.length > 0,
    parseOk:         !parseError,
    parseError:      parseError || null,
    projectId:       parsed?.project_id || parsed?.projectId || null,
    hasPrivateKey:   !!(parsed?.private_key),
    hasClientEmail:  !!(parsed?.client_email),
    envKeys: Object.keys(process.env).filter(k =>
      k.startsWith('FIREBASE') || k.startsWith('QSTASH') || k.startsWith('VITE')
    ),
  });
}
