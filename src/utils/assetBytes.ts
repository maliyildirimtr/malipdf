/**
 * Read a bundled asset URL as bytes.
 *
 * Production builds inline small binary assets (fonts, CMaps) as data: URLs
 * (see vite.config.ts), because a packaged app is served from file:// where
 * fetch() is unavailable and the CSP blocks fetching data: URLs. In `vite dev`
 * URLs are same-origin http URLs and are fetched; XHR is a last resort.
 */
export async function readAssetBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) return dataUrlToBytes(url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (fetchError) {
    return new Promise<Uint8Array>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url);
      request.responseType = 'arraybuffer';
      request.onload = () => (request.response
        ? resolve(new Uint8Array(request.response as ArrayBuffer))
        : reject(fetchError));
      request.onerror = () => reject(fetchError);
      request.send();
    });
  }
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
