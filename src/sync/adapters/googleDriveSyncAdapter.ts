/**
 * Universal Google Drive Sync Adapter (REST API v3).
 *
 * Bridges ALL ecosystems — iPad · iPhone · Mac · Windows · Android — using the
 * user's own free 15 GB Google Drive (`MaliPDF/` folder, `drive.file` scope)
 * with $0 server cost.
 */

import { useSyncStore } from '../../store/syncStore';
import { parseSyncManifest, type RemoteFileEntry, type SyncAdapter, type SyncManifest } from '../syncTypes';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const ROOT_FOLDER_NAME = 'MaliPDF';
const MANIFEST_NAME = 'library-sync.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

interface DriveFileItem {
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
}

export class GoogleDriveSyncAdapter implements SyncAdapter {
  readonly id = 'gdrive' as const;

  private getToken(): string | null {
    const { googleAccessToken, googleTokenExpiresAt } = useSyncStore.getState();
    if (!googleAccessToken) return null;
    if (googleTokenExpiresAt && Date.now() > googleTokenExpiresAt - 30_000) return null;
    return googleAccessToken;
  }

  private authHeaders(): HeadersInit {
    const token = this.getToken();
    if (!token) throw new Error('Google Drive session expired. Please reconnect.');
    return { Authorization: `Bearer ${token}` };
  }

  async isAvailable(): Promise<boolean> {
    return typeof fetch === 'function';
  }

  async isConnected(): Promise<boolean> {
    return Boolean(this.getToken());
  }

  /**
   * Connects via either a supplied OAuth access token or interactive Google
   * OAuth2 sign-in popup (when a Google OAuth Client ID is configured).
   */
  async connect(options?: Record<string, unknown>): Promise<boolean> {
    const manualToken = typeof options?.accessToken === 'string' ? options.accessToken.trim() : '';
    if (manualToken) {
      const email = await this.fetchUserEmail(manualToken).catch(() => null);
      useSyncStore.getState().setGoogleSession({
        accessToken: manualToken,
        expiresAt: Date.now() + 55 * 60 * 1000,
        email,
      });
      await this.ensureRootFolder();
      return true;
    }

    const clientId = (typeof options?.clientId === 'string' ? options.clientId : useSyncStore.getState().googleClientId).trim();
    if (!clientId) {
      throw new Error('Google OAuth Client ID is required to sign in to Google Drive.');
    }

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', DRIVE_SCOPE);
    authUrl.searchParams.set('prompt', 'consent');

    const popup = window.open(authUrl.toString(), 'malipdf-google-auth', 'width=520,height=640');
    if (!popup) {
      throw new Error('Could not open Google sign-in window. Please allow popups or connect via access token.');
    }

    const tokenResult = await new Promise<{ accessToken: string; expiresIn: number } | null>((resolve) => {
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          resolve(null);
          return;
        }
        try {
          const hash = popup.location.hash;
          if (hash && hash.includes('access_token=')) {
            const params = new URLSearchParams(hash.replace(/^#/, ''));
            const accessToken = params.get('access_token');
            const expiresIn = Number(params.get('expires_in') || 3600);
            popup.close();
            window.clearInterval(timer);
            resolve(accessToken ? { accessToken, expiresIn } : null);
          }
        } catch {
          // Cross-origin while user is on accounts.google.com — keep waiting
        }
      }, 300);
      window.setTimeout(() => {
        window.clearInterval(timer);
        if (!popup.closed) popup.close();
        resolve(null);
      }, 120_000);
    });

    if (!tokenResult) return false;
    const email = await this.fetchUserEmail(tokenResult.accessToken).catch(() => null);
    useSyncStore.getState().setGoogleSession({
      accessToken: tokenResult.accessToken,
      expiresAt: Date.now() + tokenResult.expiresIn * 1000,
      email,
    });
    await this.ensureRootFolder();
    return true;
  }

  async disconnect(): Promise<void> {
    useSyncStore.getState().setGoogleSession(null);
  }

  private async fetchUserEmail(token: string): Promise<string | null> {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  }

  private async ensureRootFolder(): Promise<string> {
    const cached = useSyncStore.getState().googleRootFolderId;
    if (cached) return cached;

    const q = `name = '${ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const listRes = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`, {
      headers: this.authHeaders(),
    });
    if (!listRes.ok) throw new Error(`Google Drive error (${listRes.status})`);
    const listData = (await listRes.json()) as { files?: DriveFileItem[] };
    if (listData.files && listData.files.length > 0) {
      useSyncStore.getState().setGoogleRootFolderId(listData.files[0].id);
      return listData.files[0].id;
    }

    const createRes = await fetch(`${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ROOT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!createRes.ok) throw new Error(`Could not create MaliPDF folder on Google Drive (${createRes.status})`);
    const created = (await createRes.json()) as { id: string };
    useSyncStore.getState().setGoogleRootFolderId(created.id);
    return created.id;
  }

  private async findFileByName(name: string): Promise<DriveFileItem | null> {
    const folderId = await this.ensureRootFolder();
    const safeName = name.replace(/'/g, "\\'");
    const q = `name = '${safeName}' and '${folderId}' in parents and trashed = false`;
    const res = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime)`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Google Drive lookup failed (${res.status})`);
    const data = (await res.json()) as { files?: DriveFileItem[] };
    return data.files?.[0] ?? null;
  }

  private async uploadFile(name: string, mimeType: string, payload: Uint8Array): Promise<void> {
    const folderId = await this.ensureRootFolder();
    const existing = await this.findFileByName(name);
    const boundary = `malipdf_boundary_${Date.now()}`;
    const metadata = existing ? { name } : { name, parents: [folderId] };

    const preamble = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
      + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const epilogue = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(preamble.byteLength + payload.byteLength + epilogue.byteLength);
    body.set(preamble, 0);
    body.set(payload, preamble.byteLength);
    body.set(epilogue, preamble.byteLength + payload.byteLength);

    const url = existing
      ? `${DRIVE_UPLOAD}/files/${existing.id}?uploadType=multipart`
      : `${DRIVE_UPLOAD}/files?uploadType=multipart`;
    const res = await fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) throw new Error(`Google Drive upload failed for ${name} (${res.status})`);
  }

  /** null ONLY when the manifest file does not exist; any failure throws (see SyncAdapter). */
  async readManifest(): Promise<SyncManifest | null> {
    const file = await this.findFileByName(MANIFEST_NAME);
    if (!file) return null;
    const res = await fetch(`${DRIVE_API}/files/${file.id}?alt=media`, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`Google Drive could not read the sync index (${res.status}).`);
    return parseSyncManifest(new Uint8Array(await res.arrayBuffer()));
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    await this.uploadFile(MANIFEST_NAME, 'application/json', bytes);
  }

  async readPdf(remoteName: string): Promise<Uint8Array | null> {
    const file = await this.findFileByName(remoteName);
    if (!file) return null;
    const res = await fetch(`${DRIVE_API}/files/${file.id}?alt=media`, { headers: this.authHeaders() });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async writePdf(remoteName: string, bytes: Uint8Array): Promise<void> {
    await this.uploadFile(remoteName, 'application/pdf', bytes);
  }

  async deletePdf(remoteName: string): Promise<void> {
    const file = await this.findFileByName(remoteName);
    if (!file) return;
    await fetch(`${DRIVE_API}/files/${file.id}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  async listRemotePdfs(): Promise<RemoteFileEntry[]> {
    const folderId = await this.ensureRootFolder();
    const q = `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const res = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime)&pageSize=1000`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Google Drive list failed (${res.status})`);
    const data = (await res.json()) as { files?: DriveFileItem[] };
    return (data.files ?? [])
      .filter((f) => /\.pdf$/i.test(f.name))
      .map((f) => ({
        name: f.name,
        size: Number(f.size ?? 0),
        updatedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : Date.now(),
      }));
  }
}
