// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * OAuth 2.0 Authorization Code Flow with PKCE for SAS Viya.
 * TypeScript port of sas_viya_auth.py.
 */

import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { URL, URLSearchParams } from 'node:url';

// --- Types ---

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface UserInfo {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

// --- PKCE Generation ---

const ALLOWED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generate PKCE code verifier and code challenge per RFC 7636.
 */
export function generatePkce(): PkceChallenge {
  // 128-character code verifier from allowed character set
  const codeVerifier = Array.from({ length: 128 }, () =>
    ALLOWED_CHARS[crypto.randomInt(ALLOWED_CHARS.length)]
  ).join('');

  // BASE64URL(SHA256(code_verifier)) — Node.js base64url omits padding
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier, 'ascii')
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

// --- Authorization URL ---

/**
 * Build the OAuth authorization URL for SAS Viya.
 */
export function buildAuthorizationUrl(
  viyaUrl: string,
  clientId: string,
  codeChallenge: string,
  state: string = 'mas-scorer-electron'
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
  });
  return `${viyaUrl.replace(/\/+$/, '')}/SASLogon/oauth/authorize?${params}`;
}

// --- HTTP helper ---

function makeRequest(
  url: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    insecureSsl?: boolean;
  }
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';

    const requestOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: options.headers || {},
      rejectUnauthorized: options.insecureSsl ? false : undefined,
    };

    const transport = isHttps ? https : http;
    const req = transport.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode || 0, data });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// --- Token Exchange ---

/**
 * Exchange an authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(
  viyaUrl: string,
  clientId: string,
  clientSecret: string,
  authCode: string,
  codeVerifier: string,
  insecureSsl: boolean = false
): Promise<TokenResponse> {
  const tokenUrl = `${viyaUrl.replace(/\/+$/, '')}/SASLogon/oauth/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: authCode,
    code_verifier: codeVerifier,
  }).toString();

  const response = await makeRequest(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    insecureSsl,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${response.data}`);
  }

  return JSON.parse(response.data) as TokenResponse;
}

// --- Token Refresh ---

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(
  viyaUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  insecureSsl: boolean = false
): Promise<TokenResponse> {
  const tokenUrl = `${viyaUrl.replace(/\/+$/, '')}/SASLogon/oauth/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString();

  const response = await makeRequest(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    insecureSsl,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Token refresh failed (HTTP ${response.status}): ${response.data}`);
  }

  return JSON.parse(response.data) as TokenResponse;
}

// --- Current User ---

/**
 * Get information about the currently authenticated user.
 */
export async function getCurrentUser(
  viyaUrl: string,
  accessToken: string,
  insecureSsl: boolean = false
): Promise<UserInfo> {
  const userUrl = `${viyaUrl.replace(/\/+$/, '')}/identities/users/@currentUser`;

  const response = await makeRequest(userUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    insecureSsl,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Get current user failed (HTTP ${response.status}): ${response.data}`);
  }

  return JSON.parse(response.data) as UserInfo;
}
