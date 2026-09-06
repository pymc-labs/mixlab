import { useEffect, useReducer, useRef, useState } from 'react';
import type { RawTable } from '../lib/core';
import {
  createWorkspace,
  parseWorkspace,
  workspaceReducer,
  type WorkspaceAction,
} from '../lib/workspace';
import { loadWorkspace, saveWorkspace } from '../lib/workspace-storage';

export function useWorkspace(example: RawTable) {
  const [workspace, dispatch] = useReducer(
    workspaceReducer,
    example,
    createWorkspace,
  );
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState('loading');
  const [storageNotice, setStorageNotice] = useState('');
  const edited = useRef(false),
    revision = useRef(0),
    enabled = useRef(false);
  const queue = useRef(Promise.resolve());
  const lastFitCount = useRef(0);
  function act(action: WorkspaceAction) {
    edited.current = true;
    if (enabled.current) setSaveStatus('saving');
    dispatch(action);
  }
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const saved = await loadWorkspace('latest');
        if (cancelled) return;
        revision.current = saved?.revision ?? 0;
        let legacy: string | null = null;
        try {
          if (!saved) legacy = sessionStorage.getItem('mixlab-workspace-v1');
        } catch {
          /* IndexedDB can still work when session storage is disabled. */
        }
        const restored =
          saved?.workspace ?? (legacy ? parseWorkspace(legacy) : null);
        if (restored && !edited.current) {
          // Recover the example label from the actual data, never an imported flag.
          for (const d of [restored.draft, ...restored.fits])
            d.dataset.example =
              JSON.stringify(d.dataset.rows) === JSON.stringify(example.rows);
          dispatch({ type: 'restore', workspace: restored });
          setStorageNotice('Your local work and completed fits were restored.');
          enabled.current = true;
          // Migrate the old tab backup once; opening a current save is read-only.
          if (legacy) edited.current = true;
        } else if (restored) {
          setStorageNotice(
            'Earlier local work is available on reload. Export these new changes first; autosave is paused to keep both safe.',
          );
        } else enabled.current = true;
        setSaveStatus(
          enabled.current
            ? edited.current
              ? 'saving'
              : 'saved'
            : 'unavailable',
        );
      } catch {
        if (!cancelled) {
          setSaveStatus('unavailable');
          setStorageNotice(
            'Local work could not be opened. You can keep working and export a project; the previous save has not been replaced.',
          );
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [example]);
  useEffect(() => {
    if (!hydrated || !enabled.current || !edited.current) return;
    let current = true;
    const newFit = workspace.fits.length !== lastFitCount.current;
    lastFitCount.current = workspace.fits.length;
    // Serialize transactions, including quick edits while a large fit is saving.
    // A committed older snapshot can never overtake a newer one.
    const persist = () => {
      queue.current = queue.current.then(async () => {
        if (!enabled.current) return;
        try {
          await saveWorkspace('latest', workspace, revision.current);
          revision.current++;
          if (current) setSaveStatus('saved');
        } catch (error) {
          enabled.current = false;
          setSaveStatus('unavailable');
          setStorageNotice(
            error instanceof Error
              ? `${error.message} Export your project to keep this work.`
              : 'Local save unavailable. Export your project to keep this work.',
          );
        }
      });
    };
    // Fit results save immediately; rapid slider edits coalesce into one write.
    const timer = newFit ? null : setTimeout(persist, 250);
    if (newFit) persist();
    return () => {
      current = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [workspace, hydrated]);
  return {
    workspace,
    act,
    saveStatus,
    storageNotice,
    markActive: () => {
      edited.current = true;
    },
    dismissStorageNotice: () => setStorageNotice(''),
  };
}
