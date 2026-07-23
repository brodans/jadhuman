export default async function handler(req: any, res: any) {
  // Disable Node SSL validation check for this proxy function to handle Direct IP HTTPS requests
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { path, use_base_url } = req.query;
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: "Path is required" });
    }
    
    // If use_base_url is true, use Direct IP HTTPS bypass for Cloudflare
    const baseUrl = use_base_url === 'true' ? 'https://103.109.206.102' : 'http://103.109.206.102:8087';
    const imageUrl = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    
    const USER_AGENTS = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
    ];
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const headers: Record<string, string> = {
      "User-Agent": randomUserAgent,
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache"
    };

    if (use_base_url === 'true') {
      headers["Host"] = "presensi.ponorogo.go.id";
    }

    const response = await fetch(imageUrl, {
      method: "GET",
      headers
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch image" });
    }

    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.status(200).send(buffer);
  } catch (err: any) {
    console.error("Proxy image error:", err);
    res.status(500).json({ error: err.message });
  }
}
