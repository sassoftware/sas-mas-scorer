// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads an image manifest from its registry without signing in, for the
 * download progress of a pull only (the layer sizes). Podman's CLI cannot
 * print the manifest of a single-platform image, and most SCR images are
 * single-platform.
 *
 * Only public repositories answer. MAS Scorer never sends registry
 * credentials: it asks the registry's token service for an anonymous pull
 * token, as any client does before signing in, and gives up on anything else.
 * The fetch function comes from the main process (a separate in-memory
 * session with normal certificate checks and no cookies).
 */

export interface AnonymousResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type AnonymousFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<AnonymousResponse>;

const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

/** Docker Hub's registry API is not at docker.io itself. */
export const registryApiHost = (host: string): string => (host === 'docker.io' ? 'registry-1.docker.io' : host);

/** `Bearer realm="…",service="…",scope="…"` → its parts; null for any other challenge. */
export function parseBearerChallenge(header: string | null): { realm: string; service?: string; scope?: string } | null {
  if (!header || !/^Bearer\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const m of header.slice(7).matchAll(/([A-Za-z]+)="([^"]*)"/g)) params[m[1].toLowerCase()] = m[2];
  if (!params.realm) return null;
  return { realm: params.realm, service: params.service, scope: params.scope };
}

function tokenFrom(body: string): string | null {
  try {
    const j = JSON.parse(body) as { token?: unknown; access_token?: unknown };
    const token = typeof j.token === 'string' ? j.token : typeof j.access_token === 'string' ? j.access_token : '';
    return token && token.length < 16 * 1024 ? token : null;
  } catch {
    return null;
  }
}

/**
 * The manifest (or index) of host/repo at a tag or digest, as text; null when
 * the registry does not hand it out without a sign-in, or anything else fails.
 */
export async function readManifestAnonymously(
  fetch: AnonymousFetch,
  host: string,
  repo: string,
  reference: string,
  signal: AbortSignal
): Promise<string | null> {
  const url = `https://${registryApiHost(host)}/v2/${repo}/manifests/${reference}`;
  let res = await fetch(url, { headers: { Accept: ACCEPT }, signal });
  if (res.status === 401) {
    const challenge = parseBearerChallenge(res.headers.get('www-authenticate'));
    if (!challenge) return null;
    let realm: URL;
    try {
      realm = new URL(challenge.realm);
    } catch {
      return null;
    }
    if (realm.protocol !== 'https:') return null;
    if (challenge.service) realm.searchParams.set('service', challenge.service);
    realm.searchParams.set('scope', challenge.scope ?? `repository:${repo}:pull`);
    const tokenRes = await fetch(realm.toString(), { headers: {}, signal });
    const token = tokenRes.status === 200 ? tokenFrom(await tokenRes.text()) : null;
    if (!token) return null;
    res = await fetch(url, { headers: { Accept: ACCEPT, Authorization: `Bearer ${token}` }, signal });
  }
  if (res.status !== 200) return null;
  const length = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) return null;
  const text = await res.text();
  return text.length > MAX_MANIFEST_BYTES ? null : text;
}
