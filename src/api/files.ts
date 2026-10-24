// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

/**
 * Read a Files-service resource (/files/files/{id}) as text, e.g. the log a
 * score execution leaves at its logFileUri. Score-execution logs are stored as
 * text/x-log, so any media type is accepted; the body is kept as raw text so
 * axios never tries to parse a log as JSON.
 */
export async function getFileText(fileUri: string): Promise<string> {
  const path = fileUri.replace(/\/content\/?$/, '') + '/content';
  const response = await sasViyaClient.get<string>(path, {
    headers: { Accept: 'text/plain, text/x-log, */*' },
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  return typeof response.data === 'string' ? response.data : String(response.data ?? '');
}
