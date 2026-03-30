// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

export interface CodeFileSignatureTerm {
  name: string;
  dataType: string;
  direction: string;
  length?: number;
  description?: string;
}

export interface CodeFileDetail {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  status?: string;
  errorMessage?: string;
  majorRevision?: number;
  minorRevision?: number;
  signature?: CodeFileSignatureTerm[];
  fileUri?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  code?: string;
  links?: { rel: string; href: string; uri: string; type?: string; method?: string }[];
  [key: string]: unknown;
}

export async function getCodeFile(href: string): Promise<string> {
  const response = await sasViyaClient.get(href, {
    headers: { Accept: 'application/vnd.sas.decision.step.code+json' },
  });
  const res = response.data;

  if (typeof res === 'string') return res;

  if (typeof res === 'object' && res !== null) {
    const obj = res as Record<string, unknown>;
    if (typeof obj.code === 'string') return obj.code;
    if (typeof obj.source === 'string') return obj.source;
    if (typeof obj.content === 'string') return obj.content;
    return JSON.stringify(res, null, 2);
  }

  return String(res);
}

export async function getCodeFileDetail(href: string): Promise<CodeFileDetail> {
  const response = await sasViyaClient.get<CodeFileDetail>(href, {
    headers: { Accept: 'application/vnd.sas.decision.code.file+json' },
  });
  return response.data;
}

export async function getFileContent(fileUri: string): Promise<string> {
  const contentUri = fileUri.endsWith('/content') ? fileUri : `${fileUri}/content`;
  const response = await sasViyaClient.get<string>(contentUri, {
    headers: { Accept: 'text/plain' },
    responseType: 'text',
  });
  return response.data;
}

export function stripLeadingJsonComment(code: string): { code: string; headerJson: Record<string, unknown> | null } {
  const trimmed = code.trimStart();

  if (trimmed.startsWith('/*')) {
    const endIdx = trimmed.indexOf('*/');
    if (endIdx !== -1) {
      const commentBody = trimmed.substring(2, endIdx).trim();
      try {
        const parsed = JSON.parse(commentBody);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const rest = trimmed.substring(endIdx + 2).trimStart();
          return { code: rest, headerJson: parsed };
        }
      } catch { /* not JSON, keep as-is */ }
    }
  }

  if (trimmed.startsWith('#')) {
    const lines = trimmed.split('\n');
    let commentText = '';
    let lineCount = 0;
    for (const line of lines) {
      const stripped = line.trimStart();
      if (stripped.startsWith('#')) {
        commentText += stripped.substring(1);
        lineCount++;
      } else {
        break;
      }
    }
    try {
      const parsed = JSON.parse(commentText.trim());
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const rest = lines.slice(lineCount).join('\n').trimStart();
        return { code: rest, headerJson: parsed };
      }
    } catch { /* not JSON */ }
  }

  return { code, headerJson: null };
}
