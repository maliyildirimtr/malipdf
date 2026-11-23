/**
 * Access to the native (Capacitor) shell of the iPad app.
 *
 * The web code does not import @capacitor/* packages: the iOS shell injects
 * window.Capacitor with its bridge, and the plugins are called through it.
 * The desktop build therefore has no Capacitor dependency at all.
 */

type Listener = (data: any) => void;

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<any>;
  nativeCallback?: (plugin: string, method: string, options: unknown, callback: Listener) => string;
  Plugins?: Record<string, Record<string, (...args: any[]) => any> | undefined>;
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

/** Running inside the iPad (iOS) app. */
export function isIpadApp(): boolean {
  return capacitor()?.getPlatform?.() === 'ios';
}

const NATIVE_TIMEOUT_MS = 10_000;
const INTERACTIVE_PLUGINS = new Set(['Share', 'Browser']);

/** Calls a native plugin method; rejects when the plugin is not installed or times out. */
export function callNative<T = any>(plugin: string, method: string, options: Record<string, unknown> = {}): Promise<T> {
  const cap = capacitor();
  if (!cap) return Promise.reject(new Error('Not running in the iPad app.'));
  const proxy = cap.Plugins?.[plugin];
  let promise: Promise<T>;
  if (typeof proxy?.[method] === 'function') {
    promise = Promise.resolve(proxy[method](options));
  } else if (cap.nativePromise) {
    promise = cap.nativePromise(plugin, method, options);
  } else {
    return Promise.reject(new Error(`${plugin} is not available.`));
  }

  if (INTERACTIVE_PLUGINS.has(plugin)) return promise;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${plugin}.${method} timed out.`)), NATIVE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Listens to a native plugin event. Returns a function that stops listening. */
export function onNative(plugin: string, eventName: string, listener: Listener): () => void {
  const cap = capacitor();
  if (!cap) return () => {};
  const proxy = cap.Plugins?.[plugin];
  if (typeof proxy?.addListener === 'function') {
    const handle = proxy.addListener(eventName, listener);
    return () => { void Promise.resolve(handle).then((h: any) => h?.remove?.()); };
  }
  if (!cap.nativeCallback) return () => {};
  const callbackId = cap.nativeCallback(plugin, 'addListener', { eventName }, listener);
  return () => { void callNative(plugin, 'removeListener', { eventName, callbackId }).catch(() => {}); };
}

// ── Bytes ↔ base64 (the bridge carries binary data as base64) ───────────────

export function bytesToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^,]*,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
