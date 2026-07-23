import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import https from "https";
import { URL as NodeURL } from "url";
import { createRequire } from "module";
import { Client as QStashClient } from "@upstash/qstash";

// ─── Auto-load .env file ────────────────────────────────────────────────────
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile();
  }
} catch {
  // Abaikan error jika file .env tidak ada (misal di produksi / Vercel)
}

// firebase-admin hanya tersedia sebagai CJS — pakai createRequire agar
// kompatibel dengan ESM (tsx) dan fallback ke standard require (CJS bundle)
let admin: any;
try {
  const req = createRequire(import.meta.url);
  admin = req("firebase-admin");
} catch {
  admin = typeof require !== "undefined" ? require("firebase-admin") : null;
}

// ─── Firebase Admin lazy init ────────────────────────────────────────────────
let _fbInitialized = false;
function initAdmin() {
  if (_fbInitialized) return;
  const apps = admin.apps as any[];
  if (apps && apps.length > 0) { _fbInitialized = true; return; }
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    try {
      if (typeof (process as any).loadEnvFile === "function") {
        (process as any).loadEnvFile();
        raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      }
    } catch {}
  }
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT tidak ditemukan di .env");
  const sa = typeof raw === "string" ? JSON.parse(raw) : raw;
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  _fbInitialized = true;
}
function getFirestore() { return admin.firestore(); }
function getMessagingAdmin() { return admin.messaging(); }

// IP/base URL server absensi — bisa di-override lewat env variable
const ABSENSI_BASE_HOST = process.env.ABSENSI_BASE_HOST || '103.109.206.102';
const ABSENSI_API_URL   = `http://${ABSENSI_BASE_HOST}:8089/Ponorogo-absensApi/index.php`;
const ABSENSI_IMG_URL   = `http://${ABSENSI_BASE_HOST}:8087`;
// IP server untuk endpoint HTTPS presensi.ponorogo.go.id (bypass Cloudflare)
const PRESENSI_DIRECT_IP = process.env.PRESENSI_DIRECT_IP || '103.109.206.102';

// Regex: tanggal YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Melakukan HTTPS GET langsung ke IP server (bypass Cloudflare/DNS),
 * dengan menyertakan Host header agar virtual host routing tetap benar.
 * rejectUnauthorized: false hanya berlaku untuk koneksi ini saja, tidak global.
 */
function httpsGetDirect(
  urlStr: string,
  customHeaders: Record<string, string>,
  timeoutMs = 25000
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new NodeURL(urlStr);
      const options: https.RequestOptions = {
        hostname: PRESENSI_DIRECT_IP,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          ...customHeaders,
          'Host': parsed.hostname, // pastikan virtual host terbaca benar
        },
        rejectUnauthorized: false, // scoped: hanya untuk koneksi ini
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode || 500, body: data }));
      });

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${timeoutMs}ms`)));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // CORS — hanya izinkan origin yang terdaftar
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      // Izinkan requests tanpa origin (server-to-server, curl, Electron, dll)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" tidak diizinkan`));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
    "Dart/3.0 (dart:io)"
  ];

  function getObfuscatedHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    
    const headers: Record<string, string> = {
      "User-Agent": randomUserAgent,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    };

    for (const [key, value] of Object.entries(customHeaders)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === 'x-forwarded-for' || 
        lowerKey === 'x-real-ip' || 
        lowerKey === 'client-ip' || 
        lowerKey === 'referer' || 
        lowerKey === 'origin' ||
        lowerKey === 'host'
      ) {
        continue;
      }
      headers[key] = value;
    }

    return headers;
  }

  async function fetchWithRetryAndTimeout(
    url: string,
    options: RequestInit = {},
    retries = 2,
    timeoutMs = 30000
  ): Promise<Response> {
    // Obfuscate outgoing headers to protect client IP and device identity
    const incomingHeaders = (options.headers || {}) as Record<string, string>;
    const obfuscated = getObfuscatedHeaders(incomingHeaders);
    const cleanOptions = {
      ...options,
      headers: obfuscated
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          ...cleanOptions,
          signal: controller.signal
        });
        clearTimeout(id);
        return response;
      } catch (err: any) {
        clearTimeout(id);
        const isTimeout = err.name === 'AbortError';
        
        if (attempt === retries) {
          if (isTimeout) {
            throw new Error(`Timeout ${timeoutMs}ms saat menghubungi server pusat. Silakan coba lagi.`);
          }
          throw err;
        }
        console.warn(`Percobaan proxy ke-${attempt} gagal. Mencoba kembali... (${err.message})`);
        await new Promise(resolve => setTimeout(resolve, attempt * 800));
      }
    }
    throw new Error("Gagal menghubungi server tujuan.");
  }

  app.post("/api/proxy", async (req, res) => {
    try {
      const { endpoint, payload } = req.body;
      const url = `${ABSENSI_API_URL}${endpoint}`;
      
      const params = new URLSearchParams();
      if (payload) {
        for (const key in payload) {
          if (payload[key] !== undefined && payload[key] !== null) {
            params.append(key, payload[key]);
          }
        }
      }

      const response = await fetchWithRetryAndTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Dart/3.0 (dart:io)",
          "Accept": "application/json",
          "Authorization": "Bearer null"
        },
        body: params.toString(),
      }, 2, 25000);

      const data = await response.text();
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch (e) {
        res.status(500).json({ error: "Gagal memproses JSON dari server pusat", text: data });
      }
    } catch (err: any) {
      console.error("Proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/absensi-log-proxy", async (req, res) => {
    try {
      const { unor, dateStart, dateEnd, page, size, nama, nip } = req.query;

      // Validasi format tanggal
      const start = String(dateStart || '').trim();
      const end   = String(dateEnd   || '').trim();
      if (start && !DATE_RE.test(start)) return res.status(400).json({ error: 'Format dateStart tidak valid (YYYY-MM-DD).' });
      if (end   && !DATE_RE.test(end))   return res.status(400).json({ error: 'Format dateEnd tidak valid (YYYY-MM-DD).' });

      const finalStart = start || new Date().toISOString().split('T')[0];
      const finalEnd   = end   || new Date().toISOString().split('T')[0];

      const requestedPage = Math.max(1, parseInt(String(page || '1'), 10));
      const s = Math.min(100, Math.max(1, parseInt(String(size || '10'), 10)));

      // Strip karakter berbahaya dari string filter
      const stripDanger = (v: unknown) => String(v || '').replace(/[^a-zA-Z0-9 ._\-]/g, '').trim();

      const unorVal = unor && String(unor).trim() !== '' ? stripDanger(unor) : 'null';
      const namaVal = nama ? encodeURIComponent(stripDanger(nama)) : 'null';
      const nipVal  = nip  ? encodeURIComponent(stripDanger(nip))  : 'null';

      if (unorVal === 'null' && namaVal === 'null' && nipVal === 'null') {
        return res.status(400).json({ error: 'Pilih instansi atau masukkan nama/NIP untuk melakukan pencarian.' });
      }

      const targetUrl = `https://presensi.ponorogo.go.id/api/absensi-log/unor/${unorVal}/${finalStart}/${finalEnd}/${namaVal}/${nipVal}?page.page=${requestedPage}&page.size=${s}&page=${requestedPage}&size=${s}`;
      
      console.log("Proxying absensi log request to:", targetUrl);
      
      const response = await httpsGetDirect(targetUrl, {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://presensi.ponorogo.go.id/",
        "Origin": "https://presensi.ponorogo.go.id",
        "Cache-Control": "no-cache",
      }, 25000);

      if (response.status !== 200) {
        console.error(`[absensi-log-proxy] Upstream returned HTTP ${response.status}:`, response.body.substring(0, 300));
        return res.status(response.status).json({
          error: `Server pusat mengembalikan HTTP ${response.status}`,
          detail: response.body.substring(0, 500)
        });
      }

      try {
        const jsonData = JSON.parse(response.body);
        res.json(jsonData);
      } catch (e) {
        console.error("[absensi-log-proxy] Failed to parse JSON:", response.body.substring(0, 300));
        res.status(500).json({ error: "Gagal memproses JSON dari server absensi log", text: response.body.substring(0, 500) });
      }
    } catch (err: any) {
      console.error("Proxy absensi-log error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/report-pdf", async (req, res) => {
    try {
      const { reportType, idp, idu, t1, t2, status, format } = req.query;
      
      const fileExt = format === 'xls' ? 'xls' : 'pdf';
      
      let targetUrl = '';
      if (reportType === 'per-pegawai') {
        targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/per-pegawai.${fileExt}?idp=${idp}&t1=${t1}&t2=${t2}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
      } else if (reportType === 'per-pegawai-aktivitas') {
        targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/per-pegawai-aktivitas.${fileExt}?idp=${idp}&t1=${t1}&t2=${t2}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
      } else if (reportType === 'rekap-instansi') {
        targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/rekap-instansi.${fileExt}?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'all'}`;
      } else if (reportType === 'skor-per-instansi') {
        if (fileExt === 'xls') {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/skor-per-instansi2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
        } else {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/skor-per-instansi2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
        }
      } else if (reportType === 'aktivitas-per-instansi') {
        if (fileExt === 'xls') {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/aktivitas-per-instansi2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
        } else {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/aktivitas-per-instansi2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
        }
      } else if (reportType === 'rekap-tpp-aktivitas') {
        if (fileExt === 'xls') {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/rekap-tpp-aktivitas2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
        } else {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/rekap-tpp-aktivitas2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
        }
      } else {
        return res.status(400).json({ error: "reportType tidak valid atau tidak didukung" });
      }

      console.log(`Proxying report ${fileExt.toUpperCase()} (${reportType}) request to:`, targetUrl);

      const response = await fetchWithRetryAndTimeout(targetUrl, {
        method: "GET",
        headers: {
          "Accept": fileExt === 'xls' ? "application/vnd.ms-excel, application/octet-stream, */*" : "application/pdf, application/octet-stream, */*",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8,ms;q=0.7",
        },
      }, 2, 60000);

      if (response.redirected) {
        return res.status(401).json({ error: "Sesi Kedaluwarsa / Dialihkan oleh server pusat", isRedirected: true });
      }

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("html")) {
        const text = await response.text();
        if (text.includes("login.html") || text.includes("login-form")) {
          return res.status(401).json({ error: "Sesi Kedaluwarsa (Menerima Halaman Login)", isRedirected: true });
        } else {
          return res.status(500).json({ error: `Gagal mengunduh report ${fileExt.toUpperCase()}. Server mengembalikan halaman non-${fileExt.toUpperCase()}.`, textSnippet: text.substring(0, 500) });
        }
      }

      if (!response.ok) {
        return res.status(response.status).json({ error: `Gagal memuat report ${fileExt.toUpperCase()}. Status server: ${response.status}` });
      }

      if (fileExt === 'xls') {
        res.setHeader("Content-Type", "application/vnd.ms-excel");
      } else {
        res.setHeader("Content-Type", "application/pdf");
      }
      
      const filename = `${reportType}-${t1}-ke-${t2}.${fileExt}`;
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (err: any) {
      console.error("Proxy report-pdf error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/proxy-image", async (req, res) => {
    try {
      const { path, use_base_url } = req.query;
      if (!path || typeof path !== 'string') {
        return res.status(400).json({ error: "Path is required" });
      }
      
      let cleanPath = path.trim();
      // Bersihkan format path
      if (!cleanPath.startsWith('http://') && !cleanPath.startsWith('https://')) {
        cleanPath = cleanPath.replace(/\/+/g, '/');
        if (!cleanPath.startsWith('/')) {
          cleanPath = '/' + cleanPath;
        }
      }

      let primaryUrl = '';
      let fallbackUrl = '';

      if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
        try {
          const parsed = new NodeURL(cleanPath);
          const allowedHosts = [ABSENSI_BASE_HOST, 'presensi.ponorogo.go.id', 'ponorogo.go.id'];
          const isAllowed = allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
          if (!isAllowed) {
            return res.status(403).json({ error: "Host gambar tidak diizinkan" });
          }
        } catch {
          return res.status(400).json({ error: "URL gambar tidak valid" });
        }
        primaryUrl = cleanPath;
      } else {
        const port8087Url = `${ABSENSI_IMG_URL}${cleanPath}`;
        const port80Url = `https://presensi.ponorogo.go.id${cleanPath}`;
        
        if (use_base_url === 'true') {
          primaryUrl = port80Url;
          fallbackUrl = port8087Url;
        } else {
          primaryUrl = port8087Url;
          fallbackUrl = port80Url;
        }
      }
      
      let response;
      try {
        console.log(`[Proxy Image] Fetching primary URL: ${primaryUrl}`);
        response = await fetchWithRetryAndTimeout(primaryUrl, {
          method: "GET",
        }, 2, 15000);
        
        if (!response.ok && fallbackUrl) {
          console.warn(`[Proxy Image] Primary URL returned HTTP ${response.status}. Trying fallback: ${fallbackUrl}`);
          const fallbackResponse = await fetchWithRetryAndTimeout(fallbackUrl, {
            method: "GET",
          }, 2, 15000);
          
          if (fallbackResponse.ok) {
            response = fallbackResponse;
          }
        }
      } catch (err: any) {
        if (fallbackUrl) {
          console.warn(`[Proxy Image] Primary URL threw error: ${err.message}. Trying fallback: ${fallbackUrl}`);
          try {
            response = await fetchWithRetryAndTimeout(fallbackUrl, {
              method: "GET",
            }, 2, 15000);
          } catch (fallbackErr: any) {
            throw new Error(`Both primary and fallback image fetches failed. Primary error: ${err.message}. Fallback error: ${fallbackErr.message}`);
          }
        } else {
          throw err;
        }
      }
      
      if (!response || !response.ok) {
        const status = response ? response.status : 500;
        return res.status(status).json({ error: "Gagal memuat gambar dari kedua server" });
      }

      const contentType = response.headers.get("content-type");
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }
      
      // Tambahkan Cache-Control untuk menghemat kuota data dan mempercepat loading
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache 24 jam
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (err: any) {
      console.error("Proxy image error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── /api/debug-devices ─────────────────────────────────────────────────────
  app.get("/api/debug-devices", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      initAdmin();
      const userId = (req.query.userId as string) || "default_admin";
      const db = getFirestore();
      const tokenDoc = await db.collection("jadhuman_fcm_tokens").doc(userId).get();
      if (!tokenDoc.exists) {
        return res.status(200).json({ exists: false, userId, devices: [], deviceCount: 0 });
      }
      const data = tokenDoc.data()!;
      const devices: any[] = (data.devices || []).map((d: any) => ({
        token:        d.token        || "",
        tokenId:      d.tokenId      || (d.token ? d.token.substring(0, 20) + "..." : ""),
        deviceInfo:   d.deviceInfo   || "Unknown",
        platform:     d.platform     || "",
        browser:      d.browser      || "",
        registeredAt: d.registeredAt || "",
        lastSeen:     d.lastSeen     || "",
      }));
      return res.status(200).json({
        exists:      true,
        userId,
        deviceCount: devices.length,
        devices,
        rootFields:  Object.keys(data).filter(k => k !== "devices"),
      });
    } catch (err: any) {
      console.error("[debug-devices] Error:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ─── /api/register-device ───────────────────────────────────────────────────
  app.post("/api/register-device", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      initAdmin();
      const { userId, token, deviceInfo, platform, browser, userAgent } = req.body ?? {};
      if (!userId || !token) {
        return res.status(400).json({ success: false, error: "userId dan token diperlukan" });
      }

      const db = getFirestore();
      const docRef = db.collection("jadhuman_fcm_tokens").doc(userId);
      const docSnap = await docRef.get();

      const now = new Date().toISOString();
      const baseLabel = deviceInfo || `${browser || "Browser"} on ${platform || "Device"}`;
      let devices: any[] = [];

      if (docSnap.exists) {
        const data = docSnap.data() || {};
        devices = Array.isArray(data.devices) ? data.devices : [];
      }

      const tokenIdShort = token.substring(0, 20);
      const existingIdx = devices.findIndex((d: any) => d.token === token || (d.tokenId && d.tokenId.startsWith(tokenIdShort)));

      if (existingIdx >= 0) {
        devices[existingIdx] = {
          ...devices[existingIdx],
          token,
          tokenId: tokenIdShort + "...",
          lastSeen: now,
          deviceInfo: baseLabel,
          platform: platform || devices[existingIdx].platform || "",
          browser: browser || devices[existingIdx].browser || "",
        };
      } else {
        const tokenId = tokenIdShort + "...";
        devices.push({
          token,
          tokenId,
          deviceInfo: baseLabel,
          platform: platform || "",
          browser: browser || "",
          userAgent: userAgent ? String(userAgent).substring(0, 150) : "",
          registeredAt: now,
          lastSeen: now,
        });
      }

      // Deduplikasi array devices agar tidak ada token / tokenId yang sama berulang
      const uniqueMap = new Map<string, any>();
      devices.forEach((d: any) => {
        const key = d.token || d.tokenId;
        if (key) uniqueMap.set(key, d);
      });
      devices = Array.from(uniqueMap.values());

      await docRef.set({
        userId,
        devices,
        updatedAt: new Date(),
      }, { merge: true });

      console.log(`[Server] Device registered for ${userId}: ${baseLabel}`);
      return res.status(200).json({ success: true, userId, deviceCount: devices.length, devices });
    } catch (err: any) {
      console.error("[register-device] Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── /api/delete-device ─────────────────────────────────────────────────────
  app.post("/api/delete-device", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      initAdmin();
      const { userId, token, deleteAll } = req.body ?? {};
      if (!userId) {
        return res.status(400).json({ success: false, error: "userId diperlukan" });
      }

      const db = getFirestore();
      const docRef = db.collection("jadhuman_fcm_tokens").doc(userId);

      if (deleteAll) {
        await docRef.delete();
        console.log(`[Server] All devices deleted for ${userId}`);
        return res.status(200).json({ success: true, deletedAll: true });
      }

      if (!token) {
        return res.status(400).json({ success: false, error: "token diperlukan untuk hapus per-device" });
      }

      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        return res.status(200).json({ success: true, devices: [] });
      }

      const data = docSnap.data() || {};
      const devices = (data.devices || []).filter((d: any) => d.token !== token);

      await docRef.update({
        devices,
        updatedAt: new Date(),
      });

      console.log(`[Server] Device deleted for ${userId}, remaining: ${devices.length}`);
      return res.status(200).json({ success: true, devices });
    } catch (err: any) {
      console.error("[delete-device] Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── /api/test-notification ─────────────────────────────────────────────────
  app.post("/api/test-notification", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      initAdmin();
      const { userId, userName } = req.body ?? {};
      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ success: false, error: "userId diperlukan" });
      }

      const db        = getFirestore();
      const messaging = getMessagingAdmin();

      const tokenDoc = await db.collection("jadhuman_fcm_tokens").doc(userId).get();
      if (!tokenDoc.exists) {
        return res.status(404).json({
          success: false,
          error: "Device belum terdaftar. Aktifkan notifikasi terlebih dahulu.",
          userId,
        });
      }

      const data    = tokenDoc.data()!;
      // Support struktur baru (array devices) dan lama (token di root)
      const devices: any[] = data.devices && Array.isArray(data.devices) && data.devices.length > 0
        ? data.devices
        : data.token ? [{ token: data.token, deviceInfo: data.deviceInfo || "Unknown", platform: data.platform || "", browser: data.browser || "" }]
        : [];

      const tokens = devices.map((d: any) => d.token).filter(Boolean);
      if (tokens.length === 0) {
        return res.status(404).json({ success: false, error: "Tidak ada device terdaftar", userId });
      }

      const { testType } = req.body ?? {};
      const isPresensi = testType === 'presensi';
      const now        = new Date();
      const displayName = userName || userId;

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
        const formatted = twoHrsAgo.toLocaleString("id-ID", {
          day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        });
        body = `${displayName} telah bekerja 2 jam! (Mulai: ${formatted}). Segera akhiri sesi.`;
      }

      // Kirim ke semua device via Admin SDK sendEach
      const messages = tokens.map((token: string) => ({
        token,
        notification: { title, body },
        data: {
          type, userId,
          taskId: "test_" + now.getTime(),
          timestamp: now.toISOString(),
          tag, testMode: "true",
          targetUrl,
        },
        android: {
          priority: "high" as const,
          notification: {
            channelId: isPresensi ? "presensi_alerts" : "productivity_alerts",
            title, body,
            color: "#7c3aed",
            defaultSound: true,
            defaultVibrateTimings: true,
            notificationPriority: "PRIORITY_HIGH" as const,
            visibility: "PUBLIC" as const,
          },
        },
        apns: {
          headers: { "apns-priority": "10", "apns-push-type": "alert" },
          payload: {
            aps: {
              alert: { title, body },
              sound: "default",
              badge: 1,
              "mutable-content": 1,
              "interruption-level": "active",
            },
          },
          fcmOptions: { analyticsLabel: tag },
        },
        webpush: {
          headers: { Urgency: "high", TTL: "86400" },
          notification: {
            title, body,
            icon:               "/assets/jadhuman.svg",
            badge:              "/assets/jadhuman-monochrome-badge.svg",
            tag,
            renotify:           true,
            requireInteraction: true,
          },
          fcmOptions: { link: targetUrl },
        },
      }));

      const batchResponse = await messaging.sendEach(messages);

      const deviceResults: any[] = [];
      const failedTokens: string[] = [];
      let successCount = 0;

      batchResponse.responses.forEach((r: any, idx: number) => {
        const info = devices[idx]?.deviceInfo || `Device ${idx + 1}`;
        if (r.success) {
          successCount++;
          console.log(`[Test] ✅ ${info}`);
          deviceResults.push({ device: info, success: true });
        } else {
          const errCode = r.error?.code || "UNKNOWN";
          console.log(`[Test] ❌ ${info}: ${errCode}`);
          deviceResults.push({ device: info, success: false, error: errCode });
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered" ||
            errCode === "messaging/invalid-argument"
          ) {
            failedTokens.push(tokens[idx]);
          }
        }
      });

      // Bersihkan token tidak valid dari Firestore
      if (failedTokens.length > 0) {
        const cleanedDevices = devices.filter((d: any) => !failedTokens.includes(d.token));
        await db.collection("jadhuman_fcm_tokens").doc(userId).update({
          devices: cleanedDevices,
          updatedAt: new Date(),
        });
        console.log(`[Test] Cleaned ${failedTokens.length} invalid tokens`);
      }

      return res.status(200).json({
        success: successCount > 0,
        multicast: {
          successCount,
          failureCount: tokens.length - successCount,
          totalDevices: tokens.length,
          cleanedUpTokens: failedTokens.length,
        },
        deviceResults,
        userId,
        sentAt: now.toISOString(),
      });
    } catch (err: any) {
      console.error("[Test Notif] Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── /api/qstash-schedule (POST = schedule, DELETE = cancel) ────────────────
  app.post("/api/qstash-schedule", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const token = process.env.QSTASH_TOKEN;
      if (!token) return res.status(500).json({ success: false, error: "QSTASH_TOKEN tidak ditemukan" });
      const { userId, userName, idPegawai, taskId, tglMulai, delaySeconds } = req.body ?? {};
      if (!userId) return res.status(400).json({ success: false, error: "userId diperlukan" });
      const qstash = new QStashClient({ token });
      const TWO_HOURS = 7200;
      let delay: number;
      if (typeof delaySeconds === "number") { delay = delaySeconds > 0 ? delaySeconds : 5; }
      else if (tglMulai) { const remaining = TWO_HOURS - Math.floor((Date.now() - new Date(tglMulai).getTime()) / 1000); delay = remaining > 0 ? remaining : 5; }
      else { delay = TWO_HOURS; }
      const webhookUrl = process.env.QSTASH_WEBHOOK_URL || "https://jadhuman.vercel.app/api/qstash-webhook";
      const response = await qstash.publishJSON({
        url: webhookUrl,
        body: {
          userId,
          userName: userName || "User",
          idPegawai: idPegawai || "",
          taskId: taskId || "",
          tglMulai: tglMulai || new Date().toISOString(),
          ...(req.body || {}),
        },
        delay, retries: 2,
      });
      return res.status(200).json({ success: true, message: "QStash job dijadwalkan", messageId: response.messageId, delaySeconds: delay, scheduledAt: new Date().toISOString() });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: "Gagal schedule QStash job", details: err.message });
    }
  });

  app.delete("/api/qstash-schedule", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const token = process.env.QSTASH_TOKEN;
      if (!token) return res.status(500).json({ success: false, error: "QSTASH_TOKEN tidak ditemukan" });
      const { messageId } = req.body ?? {};
      if (!messageId) return res.status(400).json({ success: false, error: "messageId diperlukan" });
      const qstash = new QStashClient({ token });
      await qstash.messages.delete(messageId);
      return res.status(200).json({ success: true, message: "QStash job dibatalkan", messageId, canceledAt: new Date().toISOString() });
    } catch (err: any) {
      if (err.message?.includes("not found") || err.message?.includes("404")) {
        return res.status(200).json({ success: true, message: "Job sudah tidak ada (sudah trigger atau expired)", messageId: req.body?.messageId });
      }
      return res.status(500).json({ success: false, error: "Gagal cancel QStash job", details: err.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
    console.log(`Absensi API: ${ABSENSI_API_URL}`);
  });
}

startServer();
