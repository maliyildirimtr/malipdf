#!/usr/bin/env node
/**
 * Cleans up orphaned ephemeral "Created via API" Apple Development certificates
 * left behind by previous GitHub Actions macOS runners.
 *
 * Why this is needed:
 * Every ephemeral GitHub Actions runner running `xcodebuild archive -allowProvisioningUpdates`
 * creates a throwaway Apple Development certificate whose private key is permanently
 * destroyed when the VM terminates. Apple caps accounts at 10 Development certificates,
 * causing the 11th build to fail with "Your account has reached the maximum number of certificates."
 *
 * Safety guarantee:
 * ONLY revokes certificates where:
 *   - certificateType === "DEVELOPMENT"
 *   - displayName === "Created via API" (or name contains "Created via API")
 * NEVER touches Distribution, Developer ID, Mac Installer, or personal certificates.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.appstoreconnect.apple.com/v1';

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createAscJwt(keyId, issuerId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: issuerId,
      iat: now,
      exp: now + 600,
      aud: 'appstoreconnect-v1',
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64Url(signature)}`;
}

export function isEphemeralCiDevCert(cert) {
  const attrs = cert?.attributes ?? {};
  const type = String(attrs.certificateType || '');
  const name = String(attrs.name || '');
  const displayName = String(attrs.displayName || '');
  if (type !== 'DEVELOPMENT') return false;
  const createdByApi = displayName === 'Created via API' || name.includes('Created via API');
  if (!createdByApi) return false;
  // Double-guard against ever touching any personal or distribution certificate
  const combined = `${name} ${displayName}`.toUpperCase();
  if (combined.includes('DISTRIBUTION') || combined.includes('DEVELOPER ID')) return false;
  return true;
}

async function main() {
  const keyId = process.env.ASC_KEY_ID?.trim();
  const issuerId = process.env.ASC_ISSUER_ID?.trim();
  const keyP8 = process.env.ASC_KEY_P8?.trim();
  if (!keyId || !issuerId || !keyP8) {
    console.log('ASC credentials not set; skipping CI dev certificate cleanup.');
    return;
  }

  const token = createAscJwt(keyId, issuerId, keyP8);
  const headers = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(`${API_BASE}/certificates?filter[certificateType]=DEVELOPMENT&limit=50`, {
    headers,
  });
  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Failed to list certificates (${listRes.status}): ${body}`);
  }

  const { data = [] } = await listRes.json();
  const targets = data.filter(isEphemeralCiDevCert);

  if (targets.length === 0) {
    console.log('No orphaned CI Development certificates found.');
    return;
  }

  console.log(`Found ${targets.length} orphaned CI Development certificate(s) ("Created via API"); revoking...`);
  let revoked = 0;
  for (const cert of targets) {
    const delRes = await fetch(`${API_BASE}/certificates/${encodeURIComponent(cert.id)}`, {
      method: 'DELETE',
      headers,
    });
    if (delRes.ok || delRes.status === 204 || delRes.status === 404) {
      revoked++;
      console.log(`  Revoked ${cert.id} (${cert.attributes?.serialNumber || 'no-serial'})`);
    } else {
      const body = await delRes.text();
      console.warn(`  Warning: could not revoke ${cert.id} (${delRes.status}): ${body}`);
    }
  }
  console.log(`Cleanup complete: revoked ${revoked}/${targets.length} ephemeral CI Development certificate(s).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
