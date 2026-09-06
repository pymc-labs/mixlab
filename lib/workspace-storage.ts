import { readWorkspace, type Workspace } from './workspace.ts';

// Revisions prevent a second tab from silently overwriting newer local work.
const DATABASE = 'mixlab-workspaces';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('workspaces');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(Error('Local storage is blocked by another tab.'));
  });
}
export async function loadWorkspace(
  key: string,
): Promise<{ workspace: Workspace; revision: number } | null> {
  const db = await openDatabase();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction('workspaces')
        .objectStore('workspaces')
        .get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = value as
      | { workspace: unknown; revision: number }
      | undefined;
    if (
      record &&
      (!Number.isSafeInteger(record.revision) || record.revision < 1)
    )
      throw Error('The local save revision is malformed.');
    return record
      ? {
          workspace: readWorkspace(record.workspace),
          revision: record.revision,
        }
      : null;
  } finally {
    db.close();
  }
}
export async function saveWorkspace(
  key: string,
  workspace: Workspace,
  expectedRevision: number,
) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite');
      const store = tx.objectStore('workspaces');
      const current = store.get(key);
      let conflict = false;
      current.onsuccess = () => {
        if ((current.result?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
        } else store.put({ workspace, revision: expectedRevision + 1 }, key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          conflict
            ? Error(
                'Another tab saved newer work. Export this tab before reloading.',
              )
            : (tx.error ?? Error('Local save was interrupted.')),
        );
    });
  } finally {
    db.close();
  }
}
