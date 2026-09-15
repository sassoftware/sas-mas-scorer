// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getRootFolders, getFolder, getFolderMembers } from '../../api/folders';

interface BreadcrumbEntry {
  id: string;
  name: string;
}

interface FolderBrowserProps {
  selectedFolderId: string | null;
  onSelect: (folderId: string, folderName: string) => void;
  initialFolderId?: string | null;
  /**
   * When set, folder members whose `uri` starts with this prefix
   * (e.g. "/decisions/codeFiles/") are also shown as selectable rows.
   */
  pickFileUriPrefix?: string;
  /** Currently selected file id (matched against the id parsed from the uri). */
  selectedFileId?: string | null;
  /** Called when a file member is selected. */
  onSelectFile?: (fileId: string, fileName: string) => void;
}

const PAGE_SIZE = 50;

export const FolderBrowser: React.FC<FolderBrowserProps> = ({
  selectedFolderId,
  onSelect,
  initialFolderId,
  pickFileUriPrefix,
  selectedFileId,
  onSelectFile,
}) => {
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [files, setFiles] = useState<Array<{ id: string; name: string }>>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ start: 0, limit: PAGE_SIZE, count: 0 });

  // Every navigation takes a new token; a response whose token is no longer
  // current is dropped, so a slow earlier listing cannot overwrite a newer one
  // (same idiom as useJobMonitoring's statsTokenRef).
  const requestIdRef = useRef(0);
  const nextRequest = () => ++requestIdRef.current;
  const isCurrent = (token: number) => token === requestIdRef.current;

  // Load root folders
  const loadRoot = useCallback(async () => {
    const token = nextRequest();
    setLoading(true);
    setError(null);
    try {
      const [rootFolders, myFolder] = await Promise.allSettled([
        getRootFolders(),
        getFolder('@myFolder'),
      ]);
      if (!isCurrent(token)) return;

      const items: Array<{ id: string; name: string }> = [];

      // Pin "My Folder" at the top if available
      if (myFolder.status === 'fulfilled') {
        items.push({ id: myFolder.value.id, name: 'My Folder' });
      }

      if (rootFolders.status === 'fulfilled') {
        for (const f of rootFolders.value) {
          // Skip if already added as My Folder
          if (myFolder.status === 'fulfilled' && f.id === myFolder.value.id) continue;
          items.push({ id: f.id, name: f.name });
        }
      }

      setFolders(items);
      setFiles([]);
      setBreadcrumbs([]);
      setPagination({ start: 0, limit: PAGE_SIZE, count: items.length });
    } catch (err: unknown) {
      if (!isCurrent(token)) return;
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load folders');
    } finally {
      if (isCurrent(token)) setLoading(false);
    }
  }, []);

  // Load folder members. `newBreadcrumbs` may still be resolving (the restored
  // folder path looks its parent up) — it is awaited alongside the members
  // request so the two round trips overlap instead of running in series.
  const loadFolder = useCallback(async (
    folderId: string,
    newBreadcrumbs: BreadcrumbEntry[] | Promise<BreadcrumbEntry[]>,
    start = 0
  ) => {
    const token = nextRequest();
    setLoading(true);
    setError(null);
    try {
      const [response, crumbs] = await Promise.all([
        getFolderMembers(folderId, start, PAGE_SIZE),
        newBreadcrumbs,
      ]);
      if (!isCurrent(token)) return;

      const folderItems = response.items
        .filter(m => m.contentType === 'folder')
        .map(m => {
          const childId = m.uri.replace('/folders/folders/', '');
          return { id: childId, name: m.name };
        });

      setFolders(folderItems);

      if (pickFileUriPrefix) {
        const fileItems = response.items
          .filter(m => m.uri.startsWith(pickFileUriPrefix))
          .map(m => ({ id: m.uri.replace(pickFileUriPrefix, ''), name: m.name }));
        setFiles(fileItems);
      } else {
        setFiles([]);
      }

      setBreadcrumbs(crumbs);
      setPagination({ start: response.start, limit: response.limit, count: response.count });
    } catch (err: unknown) {
      if (!isCurrent(token)) return;
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load folder contents');
    } finally {
      if (isCurrent(token)) setLoading(false);
    }
  }, [pickFileUriPrefix]);

  // Navigate into a folder
  const handleOpenFolder = useCallback((folderId: string, folderName: string) => {
    const newBreadcrumbs = [...breadcrumbs, { id: folderId, name: folderName }];
    loadFolder(folderId, newBreadcrumbs);
  }, [breadcrumbs, loadFolder]);

  // Navigate via breadcrumb
  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index < 0) {
      // Go to root
      loadRoot();
      return;
    }
    const target = breadcrumbs[index];
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    loadFolder(target.id, newBreadcrumbs);
  }, [breadcrumbs, loadRoot, loadFolder]);

  // Pagination
  const currentFolderId = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].id : null;
  const hasMore = pagination.start + pagination.limit < pagination.count;
  const hasPrev = pagination.start > 0;

  const handleNextPage = useCallback(() => {
    if (!currentFolderId) return;
    const newStart = pagination.start + pagination.limit;
    loadFolder(currentFolderId, breadcrumbs, newStart);
  }, [currentFolderId, pagination, breadcrumbs, loadFolder]);

  const handlePrevPage = useCallback(() => {
    if (!currentFolderId) return;
    const newStart = Math.max(0, pagination.start - pagination.limit);
    loadFolder(currentFolderId, breadcrumbs, newStart);
  }, [currentFolderId, pagination, breadcrumbs, loadFolder]);

  // Initial load
  useEffect(() => {
    if (initialFolderId) {
      // Try to navigate to the saved folder
      getFolder(initialFolderId)
        .then(folder => {
          // Load the parent to show siblings, select this folder
          onSelect(folder.id, folder.name);
          if (folder.parentFolderUri) {
            const parentId = folder.parentFolderUri.replace('/folders/folders/', '');
            // The parent's name is only needed for the breadcrumb label, so the
            // lookup runs concurrently with the members request inside loadFolder.
            const crumbs = getFolder(parentId).then(parent => [{ id: parentId, name: parent.name }]);
            loadFolder(parentId, crumbs).catch(() => loadRoot());
          } else {
            loadRoot();
          }
        })
        .catch(() => loadRoot());
    } else {
      loadRoot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="folder-browser">
      {/* Breadcrumbs */}
      <nav className="folder-browser__breadcrumbs" aria-label="Folder path">
        <button
          className="folder-browser__breadcrumb"
          onClick={() => handleBreadcrumbClick(-1)}
          type="button"
          disabled={loading}
        >
          SAS Content
        </button>
        {breadcrumbs.map((bc, i) => (
          <React.Fragment key={bc.id}>
            <span className="folder-browser__breadcrumb-sep" aria-hidden="true">/</span>
            <button
              className="folder-browser__breadcrumb"
              onClick={() => handleBreadcrumbClick(i)}
              type="button"
              disabled={loading}
              aria-current={i === breadcrumbs.length - 1 ? 'location' : undefined}
            >
              {bc.name}
            </button>
          </React.Fragment>
        ))}
      </nav>

      {/* Folder list */}
      <div className="folder-browser__list" aria-busy={loading}>
        {loading ? (
          <div className="folder-browser__loading" role="status">Loading folders...</div>
        ) : error ? (
          <div className="folder-browser__error" role="alert">{error}</div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="folder-browser__empty">
            {pickFileUriPrefix ? 'No subfolders or code files in this location' : 'No subfolders in this location'}
          </div>
        ) : (
          <>
            {folders.map(f => (
              <div
                key={f.id}
                className={`folder-browser__item${f.id === selectedFolderId ? ' folder-browser__item--selected' : ''}`}
              >
                <button
                  className="folder-browser__item-name"
                  onClick={() => handleOpenFolder(f.id, f.name)}
                  type="button"
                  title="Open folder"
                >
                  <svg className="folder-browser__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                  </svg>
                  {f.name}
                </button>
                <button
                  className="folder-browser__select-btn"
                  onClick={() => onSelect(f.id, f.name)}
                  type="button"
                  aria-pressed={f.id === selectedFolderId}
                  aria-label={`${f.id === selectedFolderId ? 'Selected' : 'Select'} folder ${f.name}`}
                >
                  {f.id === selectedFolderId ? 'Selected' : 'Select'}
                </button>
              </div>
            ))}
            {files.map(f => (
              <div
                key={`file-${f.id}`}
                className={`folder-browser__item folder-browser__item--file${f.id === selectedFileId ? ' folder-browser__item--selected' : ''}`}
              >
                <button
                  className="folder-browser__item-name"
                  onClick={() => onSelectFile?.(f.id, f.name)}
                  type="button"
                  title="Select code file"
                >
                  <svg className="folder-browser__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm0 2l4 4h-4V4z" />
                  </svg>
                  {f.name}
                </button>
                <button
                  className="folder-browser__select-btn"
                  onClick={() => onSelectFile?.(f.id, f.name)}
                  type="button"
                  aria-pressed={f.id === selectedFileId}
                  aria-label={`${f.id === selectedFileId ? 'Selected' : 'Select'} file ${f.name}`}
                >
                  {f.id === selectedFileId ? 'Selected' : 'Select'}
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Select current folder (the one we're browsing inside) */}
      {breadcrumbs.length > 0 && (
        <div className="folder-browser__current-action">
          <button
            className="folder-browser__select-current"
            onClick={() => {
              const current = breadcrumbs[breadcrumbs.length - 1];
              onSelect(current.id, current.name);
            }}
            type="button"
          >
            {currentFolderId === selectedFolderId
              ? `Current folder selected: ${breadcrumbs[breadcrumbs.length - 1].name}`
              : `Select current folder: ${breadcrumbs[breadcrumbs.length - 1].name}`}
          </button>
        </div>
      )}

      {/* Pagination */}
      {(hasPrev || hasMore) && (
        <div className="folder-browser__pagination">
          <button onClick={handlePrevPage} disabled={!hasPrev || loading} type="button">Previous</button>
          <span>{pagination.start + 1}–{Math.min(pagination.start + pagination.limit, pagination.count)} of {pagination.count}</span>
          <button onClick={handleNextPage} disabled={!hasMore || loading} type="button">Next</button>
        </div>
      )}
    </div>
  );
};
