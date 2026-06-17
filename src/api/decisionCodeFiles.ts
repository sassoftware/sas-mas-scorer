// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Saving generated Python to SAS Intelligent Decisioning code files.
//
// Both flows are file-backed: the code is first uploaded to the Files service
// (POST /files/files), then the code file (or revision) references it via
// `fileUri` and carries the typed signature.
//
//   1. Create — POST /files/files (content) → POST /decisions/codeFiles
//      ?parentFolderUri={folder} with { description, fileUri, signature }.
//   2. Update — POST /files/files (new content) → POST /decisions/codeFiles/
//      {codeFileId}/revisions?revisionType={minor|major}&fromRevisionUri={current
//      revision} with { fileUri (new), signature }.
//
// updateCodeFile (PUT) only edits name/description, so a revision is what
// publishes new code content.

import { sasViyaClient } from './client';

const CODE_FILE_MEDIA_TYPE = 'application/vnd.sas.decision.code.file+json';
const FILE_MEDIA_TYPE = 'application/vnd.sas.file+json';

// Generated code is always a Python execute() function for SAS ID.
const CODE_FILE_TYPE = 'decisionPythonFile';

interface UploadFileResponse {
  id: string;
  name: string;
  contentType?: string;
  [key: string]: unknown;
}

export interface UploadedFile {
  fileUri: string;
  fileId: string;
  name: string;
  etag?: string;
}

export interface CodeFileResponse {
  id: string;
  name: string;
  type: string;
  status?: string;
  fileUri?: string;
  majorRevision?: number;
  minorRevision?: number;
  [key: string]: unknown;
}

export interface SaveCodeFileResult {
  fileId: string;
  codeFileId: string;
  codeFileName: string;
  status: string;
  majorRevision?: number;
  minorRevision?: number;
}

/**
 * Upload code to the Files service as text/plain. The file is created outside any
 * content folder, so repeat uploads don't collide on name — the code file asset
 * (not this file) is what lands in the user's folder. Returns the file id/uri,
 * its name, and the ETag (needed to PATCH metadata like the description).
 */
export async function uploadCodeAsFile(code: string, fileName: string): Promise<UploadedFile> {
  const response = await sasViyaClient.post<UploadFileResponse>(
    '/files/files',
    code,
    {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${fileName}.py"`,
        Accept: FILE_MEDIA_TYPE,
      },
    },
  );
  const id = response.data.id;
  return {
    fileUri: `/files/files/${id}`,
    fileId: id,
    name: response.data.name ?? `${fileName}.py`,
    etag: typeof response.headers?.etag === 'string' ? response.headers.etag : undefined,
  };
}

/**
 * Set the description on an uploaded file (PATCH /files/files/{id}). The Files
 * service only accepts a description via metadata update, not the raw upload, and
 * requires an If-Match (the file's ETag) plus the required name/searchable fields.
 */
export async function setFileDescription(file: UploadedFile, description: string): Promise<void> {
  if (!description) return;

  let etag = file.etag;
  if (!etag) {
    const current = await sasViyaClient.get(`/files/files/${encodeURIComponent(file.fileId)}`, {
      headers: { Accept: FILE_MEDIA_TYPE },
    });
    etag = typeof current.headers?.etag === 'string' ? current.headers.etag : undefined;
  }

  const headers: Record<string, string> = {
    'Content-Type': FILE_MEDIA_TYPE,
    Accept: FILE_MEDIA_TYPE,
  };
  if (etag) headers['If-Match'] = etag;

  await sasViyaClient.patch(
    `/files/files/${encodeURIComponent(file.fileId)}`,
    { name: file.name, searchable: true, description },
    { headers },
  );
}

interface CodeFileBody {
  name: string;
  description?: string;
  fileUri: string;
  signature?: unknown[];
}

/**
 * Create a new SID code file asset (POST /decisions/codeFiles) referencing an
 * already-uploaded file, in the chosen folder.
 */
export async function createCodeFile(
  body: CodeFileBody,
  parentFolderUri?: string,
): Promise<CodeFileResponse> {
  const requestBody: Record<string, unknown> = {
    name: body.name,
    type: CODE_FILE_TYPE,
    fileUri: body.fileUri,
  };
  if (body.description) requestBody.description = body.description;
  if (body.signature) requestBody.signature = body.signature;

  const response = await sasViyaClient.post<CodeFileResponse>(
    '/decisions/codeFiles',
    requestBody,
    {
      params: parentFolderUri ? { parentFolderUri } : {},
      headers: {
        'Content-Type': CODE_FILE_MEDIA_TYPE,
        Accept: CODE_FILE_MEDIA_TYPE,
      },
    },
  );
  return response.data;
}

/**
 * Resolve the URI of a code file's current (latest) revision, used as
 * `fromRevisionUri` when creating the next revision so lineage is preserved.
 * Best-effort: returns undefined if it can't be determined.
 */
export async function getLatestRevisionUri(codeFileId: string): Promise<string | undefined> {
  try {
    const response = await sasViyaClient.get(
      `/decisions/codeFiles/${encodeURIComponent(codeFileId)}/revisions`,
      { headers: { Accept: 'application/vnd.sas.collection+json' } },
    );
    const items: Array<{ id?: string; majorRevision?: number; minorRevision?: number }> =
      response.data?.items ?? [];
    if (items.length === 0) return undefined;

    const latest = items.reduce((a, b) => {
      const am = a.majorRevision ?? 0, an = a.minorRevision ?? 0;
      const bm = b.majorRevision ?? 0, bn = b.minorRevision ?? 0;
      if (bm !== am) return bm > am ? b : a;
      return bn > an ? b : a;
    });
    return latest.id
      ? `/decisions/codeFiles/${codeFileId}/revisions/${latest.id}`
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create a new revision of an existing code file referencing a newly-uploaded
 * file (POST /decisions/codeFiles/{codeFileId}/revisions). `fromRevisionUri`
 * links the new revision to the current one for lineage.
 */
export async function createCodeFileRevision(
  codeFileId: string,
  body: CodeFileBody,
  revisionType: 'minor' | 'major' = 'minor',
  fromRevisionUri?: string,
): Promise<CodeFileResponse> {
  const requestBody: Record<string, unknown> = {
    name: body.name,
    type: CODE_FILE_TYPE,
    fileUri: body.fileUri,
  };
  if (body.description) requestBody.description = body.description;
  if (body.signature) requestBody.signature = body.signature;

  const params: Record<string, string> = { revisionType };
  if (fromRevisionUri) params.fromRevisionUri = fromRevisionUri;

  const response = await sasViyaClient.post<CodeFileResponse>(
    `/decisions/codeFiles/${encodeURIComponent(codeFileId)}/revisions`,
    requestBody,
    {
      params,
      headers: {
        'Content-Type': CODE_FILE_MEDIA_TYPE,
        Accept: CODE_FILE_MEDIA_TYPE,
      },
    },
  );
  return response.data;
}

// ─── High-level orchestration used by the save dialog ───────────────

/**
 * Create a brand-new code file: upload the code to the Files service, then
 * create the code file asset in the chosen folder referencing it.
 */
export async function saveNewCodeFile(
  code: string,
  name: string,
  description: string,
  folderId: string,
  signature?: unknown[],
): Promise<SaveCodeFileResult> {
  const file = await uploadCodeAsFile(code, name);
  await setFileDescription(file, description);
  const codeFile = await createCodeFile(
    { name, description, fileUri: file.fileUri, signature },
    `/folders/folders/${folderId}`,
  );
  return {
    fileId: file.fileId,
    codeFileId: codeFile.id,
    codeFileName: codeFile.name,
    status: codeFile.status ?? 'created',
    majorRevision: codeFile.majorRevision,
    minorRevision: codeFile.minorRevision,
  };
}

/**
 * Update an existing code file: upload the new code to the Files service, then
 * create a new revision referencing the new file (with fromRevisionUri lineage).
 */
export async function updateCodeFileWithRevision(
  code: string,
  codeFileId: string,
  name: string,
  description: string,
  revisionType: 'minor' | 'major' = 'minor',
  signature?: unknown[],
): Promise<SaveCodeFileResult> {
  const file = await uploadCodeAsFile(code, name);
  await setFileDescription(file, description);
  const fromRevisionUri = await getLatestRevisionUri(codeFileId);
  const codeFile = await createCodeFileRevision(
    codeFileId,
    { name, description, fileUri: file.fileUri, signature },
    revisionType,
    fromRevisionUri,
  );
  return {
    fileId: file.fileId,
    codeFileId: codeFile.id,
    codeFileName: codeFile.name,
    status: codeFile.status ?? 'updated',
    majorRevision: codeFile.majorRevision,
    minorRevision: codeFile.minorRevision,
  };
}
