// api/_firebase-rest.ts
// Helper: Google OAuth JWT + Firestore REST + FCM v1 REST
// Zero dependency — works di semua Node version, no ESM/CJS issue

export async function getAccessToken(): Promise<string> {
  const sa  = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: [
      'https://www.googleapis.com/auth/firebase.messaging',
      'https://www.googleapis.com/auth/datastore',
    ].join(' '),
  };
  const jwt = await signJwt(payload, sa.private_key);
  const r   = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await r.json() as any;
  if (!data.access_token) throw new Error('OAuth token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function signJwt(payload: object, pem: string): Promise<string> {
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned = `${enc({ alg:'RS256', typ:'JWT' })}.${enc(payload)}`;
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),
    c => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${unsigned}.${b64}`;
}

export function getProjectId(): string {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const id = sa.project_id || sa.projectId;
  if (!id) throw new Error('project_id tidak ada di FIREBASE_SERVICE_ACCOUNT');
  return id;
}

export async function firestoreGet(projectId: string, path: string, token: string): Promise<any> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore GET ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function firestorePatch(
  projectId: string, path: string, fields: Record<string, any>,
  fieldMasks: string[], token: string
): Promise<void> {
  const masks = fieldMasks.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url   = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}?${masks}`;
  const r     = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`Firestore PATCH ${r.status}: ${await r.text()}`);
}

export function parseDevices(doc: any): Array<{
  token: string; tokenId: string; deviceInfo: string;
  platform: string; browser: string; registeredAt: string; lastSeen: string;
}> {
  const arr = doc?.fields?.devices?.arrayValue?.values || [];
  return arr.map((v: any) => {
    const f = v.mapValue?.fields || {};
    const s = (k: string) => f[k]?.stringValue || '';
    return {
      token: s('token'), tokenId: s('tokenId'), deviceInfo: s('deviceInfo'),
      platform: s('platform'), browser: s('browser'),
      registeredAt: s('registeredAt'), lastSeen: s('lastSeen'),
    };
  });
}

export function devicesToFirestore(devices: any[]): any {
  return {
    arrayValue: {
      values: devices.map(d => ({
        mapValue: {
          fields: {
            token:        { stringValue: d.token        || '' },
            tokenId:      { stringValue: d.tokenId      || '' },
            deviceInfo:   { stringValue: d.deviceInfo   || '' },
            platform:     { stringValue: d.platform     || '' },
            browser:      { stringValue: d.browser      || '' },
            registeredAt: { stringValue: d.registeredAt || '' },
            lastSeen:     { stringValue: d.lastSeen     || '' },
          },
        },
      })),
    },
  };
}

export async function sendFCMBatch(
  projectId: string, token_: string, tokens: string[],
  title: string, body: string, data: Record<string,string>,
  tag: string
): Promise<Array<{ success: boolean; error?: string; rawError?: any }>> {
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const results = await Promise.allSettled(
    tokens.map(tok =>
      fetch(fcmUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token_}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: tok,
            // notification WAJIB ada agar FCM tahu ini alert (bukan data-only)
            notification: { title, body },
            // data: semua value harus string
            data,

            // ── Android (native app / Android Chrome dengan GCM) ────────────
            // PENTING: jangan pakai click_action Flutter di web PWA
            // channel_id dibutuhkan Android O+ untuk tampilkan notif
            android: {
              priority: 'high',
              notification: {
                channel_id: 'productivity_alerts',
                title,
                body,
                color: '#7c3aed',
                default_sound: true,
                default_vibrate_timings: true,
                notification_priority: 'PRIORITY_HIGH',
                visibility: 'PUBLIC',
              },
            },

            // ── Web Push (Chrome/Edge/Firefox di PC & Android Chrome) ──────
            // webpush override MENGGANTIKAN notification di web browser
            // TTL 300s = pesan expired setelah 5 menit jika device offline
            webpush: {
              headers: {
                Urgency: 'high',
                TTL: '86400',       // 24 jam — cukup lama agar device offline tetap terima
              },
              notification: {
                title,
                body,
                icon:                '/assets/jadhuman.svg',
                badge:               '/assets/jadhuman-monochrome-badge.svg',
                tag,
                renotify:            true,
                requireInteraction:  true,
              },
              fcm_options: {
                link: '/input-aktivitas',
              },
            },

            // ── APNs (iOS Safari 16.4+ PWA) ────────────────────────────────
            apns: {
              headers: {
                'apns-priority':   '10',
                'apns-push-type':  'alert',
                'apns-expiration': '86400',
              },
              payload: {
                aps: {
                  alert:               { title, body },
                  sound:               'default',
                  badge:               1,
                  'mutable-content':   1,
                  'content-available': 1,
                  'interruption-level':'active',
                },
              },
              fcm_options: {
                analytics_label: tag,
              },
            },
          },
        }),
      }).then(async r => {
        const json = await r.json() as any;
        if (!r.ok) {
          const errStatus = json?.error?.status  || '';
          const errMsg    = json?.error?.message || r.status.toString();
          const knownErrors = ['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH', 'NOT_FOUND', 'QUOTA_EXCEEDED', 'UNAVAILABLE'];
          const code = knownErrors.find(e => errStatus.includes(e) || errMsg.includes(e))
            || errStatus
            || errMsg;
          // Log detail error untuk debug Vercel
          console.error(`[FCM] Send failed token=${tok.substring(0,20)}... status=${code}`, json?.error);
          throw Object.assign(new Error(code), { rawError: json?.error });
        }
        return json;
      })
    )
  );

  return results.map(r => {
    if (r.status === 'fulfilled') return { success: true };
    const err = r.reason as any;
    return {
      success:  false,
      error:    err?.message  || 'UNKNOWN',
      rawError: err?.rawError || null,
    };
  });
}

export function parseNotifSettings(doc: any): {
  notifEnabled: boolean;
  presensiConfig: {
    enabled: boolean;
    seninKamisMasuk: string;
    seninKamisPulang: string;
    jumatMasuk: string;
    jumatPulang: string;
  };
} | null {
  if (!doc || !doc.fields) return null;
  const f = doc.fields;
  const notifEnabled = f.notifEnabled?.booleanValue ?? true;
  const pMap = f.presensiConfig?.mapValue?.fields || {};
  return {
    notifEnabled,
    presensiConfig: {
      enabled: pMap.enabled?.booleanValue ?? false,
      seninKamisMasuk: pMap.seninKamisMasuk?.stringValue || '07:30',
      seninKamisPulang: pMap.seninKamisPulang?.stringValue || '15:45',
      jumatMasuk: pMap.jumatMasuk?.stringValue || '07:00',
      jumatPulang: pMap.jumatPulang?.stringValue || '11:30',
    },
  };
}
