export const sendRequest = async (endpoint: string, payload: Record<string, any>): Promise<any> => {
  const url = "/api/proxy";
  
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint, payload }),
    });
  } catch (fetchErr: any) {
    throw new Error(`Koneksi gagal: ${fetchErr.message}`);
  }

  const responseText = await response.text();

  if (!response.ok) {
    // Attempt to parse JSON error message from the response text
    try {
      const errJson = JSON.parse(responseText);
      if (errJson && (errJson.error || errJson.message)) {
        throw new Error(errJson.error || errJson.message);
      }
    } catch {
      // ignore parsing error and throw generic status error
    }
    throw new Error(`HTTP Error ${response.status}: ${responseText.slice(0, 150)}`);
  }

  try {
    const data = JSON.parse(responseText);
    return data;
  } catch (jsonErr) {
    if (responseText.trim().startsWith("<!doctype") || responseText.trim().startsWith("<html") || responseText.trim().startsWith("<!DOCTYPE")) {
      throw new Error(`Gagal memuat data dari server (Menerima halaman HTML). Silakan segarkan halaman dan coba lagi.`);
    }
    throw new Error(`Gagal membaca respons server (Format tidak valid): ${responseText.slice(0, 150)}`);
  }
};

