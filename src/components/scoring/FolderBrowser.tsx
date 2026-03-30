// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { getRootFolders, getFolder, getFolderMembers } from '../../api/folders';

interface BreadcrumbEntry {
  id: string;
  name: string;
}

interface FolderBrowserProps {
  selectedFolderId: string | null;
  onSelect: (folderId: string, folderName: string) => void;
  initialFolderId?: string | null;
}

export const FolderBrowser: React.FC<FolderBrowserProps> = ({
  selectedFolderId,
  onSelect,
  initialFolderId,
}) => {
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ start: 0, limit: 50, count: 0 });

  // Load root folders
  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rootFolders, myFolder] = await Promise.allSettled([
        getRootFolders(),
        getFolder('@myFolder'),
      ]);

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
      setBreadcrumbs([]);
      setPagination({ start: 0, limit: 50, count: items.length });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load folders');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load folder members
  const loadFolder = useCallback(async (folderId: string, _folderName: string, newBreadcrumbs: BreadcrumbEntry[], start = 0) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getFolderMembers(folderId, start, 50);
      const folderItems = response.items
        .filter(m => m.contentType === 'folder')
        .map(m => {
          const childId = m.uri.replace('/folders/folders/', '');
          return { id: childId, name: m.name };
        });

      setFolders(folderItems);
      setBreadcrumbs(newBreadcrumbs);
      setPagination({ start: response.start, limit: response.limit, count: response.count });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load folder contents');
    } finally {
      setLoading(false);
    }
  }, []);

  // Navigate into a folder
  const handleOpenFolder = useCallback((folderId: string, folderName: string) => {
    const newBreadcrumbs = [...breadcrumbs, { id: folderId, name: folderName }];
    loadFolder(folderId, folderName, newBreadcrumbs);
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
    loadFolder(target.id, target.name, newBreadcrumbs);
  }, [breadcrumbs, loadRoot, loadFolder]);

  // Pagination
  const currentFolderId = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].id : null;
  const hasMore = pagination.start + pagination.limit < pagination.count;
  const hasPrev = pagination.start > 0;

  const handleNextPage = useCallback(() => {
    if (!currentFolderId) return;
    const newStart = pagination.start + pagination.limit;
    loadFolder(currentFolderId, breadcrumbs[breadcrumbs.length - 1].name, breadcrumbs, newStart);
  }, [currentFolderId, pagination, breadcrumbs, loadFolder]);

  const handlePrevPage = useCallback(() => {
    if (!currentFolderId) return;
    const newStart = Math.max(0, pagination.start - pagination.limit);
    loadFolder(currentFolderId, breadcrumbs[breadcrumbs.length - 1].name, breadcrumbs, newStart);
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
            getFolder(parentId).then(parent => {
              loadFolder(parentId, parent.name, [{ id: parentId, name: parent.name }]);
            }).catch(() => loadRoot());
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
      <div className="folder-browser__breadcrumbs">
        <button
          className="folder-browser__breadcrumb"
          onClick={() => handleBreadcrumbClick(-1)}
          type="button"
        >
          SAS Content
        </button>
        {breadcrumbs.map((bc, i) => (
          <React.Fragment key={bc.id}>
            <span className="folder-browser__breadcrumb-sep">/</span>
            <button
              className="folder-browser__breadcrumb"
              onClick={() => handleBreadcrumbClick(i)}
              type="button"
            >
              {bc.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Folder list */}
      <div className="folder-browser__list">
        {loading ? (
          <div className="folder-browser__loading">Loading folders...</div>
        ) : error ? (
          <div className="folder-browser__error">{error}</div>
        ) : folders.length === 0 ? (
          <div className="folder-browser__empty">No subfolders in this location</div>
        ) : (
          folders.map(f => (
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
                <svg className="folder-browser__icon" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
                {f.name}
              </button>
              <button
                className="folder-browser__select-btn"
                onClick={() => onSelect(f.id, f.name)}
                type="button"
              >
                {f.id === selectedFolderId ? 'Selected' : 'Select'}
              </button>
            </div>
          ))
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
          <button onClick={handlePrevPage} disabled={!hasPrev} type="button">Previous</button>
          <span>{pagination.start + 1}–{Math.min(pagination.start + pagination.limit, pagination.count)} of {pagination.count}</span>
          <button onClick={handleNextPage} disabled={!hasMore} type="button">Next</button>
        </div>
      )}
    </div>
  );
};
