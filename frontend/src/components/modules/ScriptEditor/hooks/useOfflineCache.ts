'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@tiptap/react';

const DB_NAME = 'scriptEditorCache';
const STORE_NAME = 'documents';
const DB_VERSION = 1;
const DISMISSED_HINT_KEY_PREFIX = 'omni_studio.script-editor.dismissed-cache:';
const LOCAL_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

interface CachedDocument {
  projectId: string;
  content: object;
  timestamp: number;
  wordCount: number;
}

export function shouldShowLocalCacheHint(
  cacheTimestamp: number,
  now: number,
  dismissedAt: number | null,
  serverUpdatedAt = 0,
): boolean {
  return cacheTimestamp > serverUpdatedAt
    && now - cacheTimestamp < LOCAL_CACHE_MAX_AGE
    && (!dismissedAt || dismissedAt < cacheTimestamp);
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCache(projectId: string): Promise<CachedDocument | undefined> {
  const db = await openDB();
  try {
    return await new Promise<CachedDocument | undefined>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(projectId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

async function setCache(doc: CachedDocument): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.objectStore(STORE_NAME).put(doc);
    });
  } finally { db.close(); }
}

/** Cache edits locally and offer recovery when they are newer than the loaded document. */
export function useOfflineCache(projectId: string | undefined, editor: Editor | null, serverDocument: object | null = null, serverUpdatedAt = 0) {
  const [hasNewerLocal, setHasNewerLocal] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const cachedContentRef = useRef<object | null>(null);
  const cachedTimestampRef = useRef<number | null>(null);
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // On mount or projectId change, check local cache
  useEffect(() => {
    setHasNewerLocal(false);
    cachedContentRef.current = null;
    cachedTimestampRef.current = null;
    if (!projectId || !serverDocument) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await getCache(projectId);
        if (!cancelled && cached && JSON.stringify(cached.content) !== JSON.stringify(serverDocument)) {
          cachedContentRef.current = cached.content;
          cachedTimestampRef.current = cached.timestamp;
          let dismissedAt: number | null = null;
          try {
            const rawDismissedAt = window.localStorage.getItem(`${DISMISSED_HINT_KEY_PREFIX}${projectId}`);
            dismissedAt = rawDismissedAt ? Number(rawDismissedAt) : null;
          } catch {
            // Local storage can be unavailable in restricted contexts.
          }
          if (shouldShowLocalCacheHint(cached.timestamp, Date.now(), dismissedAt, serverUpdatedAt)) {
            setHasNewerLocal(true);
          }
        }
      } catch {
        // IndexedDB unavailable, ignore
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, serverDocument, serverUpdatedAt]);

  // Save to local cache (called externally after each successful save or on edits)
  const saveToLocal = useCallback(
    async (content: object, wordCount: number) => {
      if (!projectId) return;
      try {
        await setCache({
          projectId,
          content,
          timestamp: Date.now(),
          wordCount,
        });
        if (activeProjectRef.current !== projectId) return;
        cachedContentRef.current = content;
        cachedTimestampRef.current = Date.now();
      } catch {
        // Silently fail if IndexedDB is unavailable
      }
    },
    [projectId]
  );

  // Keep pending edits recoverable even when an in-app route change unmounts the editor.
  useEffect(() => {
    if (!editor || !projectId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: { content: object; wordCount: number } | null = null;
    const flush = () => {
      if (pending) void saveToLocal(pending.content, pending.wordCount);
      pending = null;
    };
    const handleUpdate = () => {
      pending = { content: editor.getJSON(), wordCount: editor.getText().length };
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    };
    editor.on('update', handleUpdate);
    return () => { editor.off('update', handleUpdate); clearTimeout(timer); flush(); };
  }, [editor, projectId, saveToLocal]);

  // Restore from local cache
  const restoreFromLocal = useCallback(() => {
    if (!editor || !cachedContentRef.current) return;
    editor.commands.setContent(cachedContentRef.current);
    if (projectId && cachedTimestampRef.current) {
      try {
        window.localStorage.setItem(`${DISMISSED_HINT_KEY_PREFIX}${projectId}`, String(cachedTimestampRef.current));
      } catch {
        // Local storage can be unavailable in restricted contexts.
      }
    }
    setHasNewerLocal(false);
  }, [editor, projectId]);

  // Dismiss the local restore hint
  const dismissLocalRestore = useCallback(() => {
    if (projectId && cachedTimestampRef.current) {
      try {
        window.localStorage.setItem(`${DISMISSED_HINT_KEY_PREFIX}${projectId}`, String(cachedTimestampRef.current));
      } catch {
        // Local storage can be unavailable in restricted contexts.
      }
    }
    setHasNewerLocal(false);
  }, [projectId]);

  return {
    hasNewerLocal,
    restoreFromLocal,
    dismissLocalRestore,
    isOffline,
    saveToLocal,
  };
}
