// Centralized brand asset loader for exports (PDF, PPTX, HTML).
// Loads the Resonance ePublisher logo from /logo-epublisher.png and caches it
// as a base64 data URI so it can be embedded directly in offline exports.

let _logoDataUrlPromise: Promise<string | null> | null = null;

export const BRAND_NAME = "Resonance ePublisher";
export const BRAND_URL = "https://www.resonanceonline.life";
export const BRAND_LOGO_PATH = "/logo-epublisher.png";

export function getBrandLogoDataUrl(): Promise<string | null> {
  if (_logoDataUrlPromise) return _logoDataUrlPromise;
  _logoDataUrlPromise = (async () => {
    try {
      const resp = await fetch(BRAND_LOGO_PATH);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();
  return _logoDataUrlPromise;
}
