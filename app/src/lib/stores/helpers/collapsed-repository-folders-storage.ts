import { getNumberArray, setNumberArray } from '../../local-storage'
import { Folder } from '../../../models/folder'

export const CollapsedRepositoryFoldersKey = 'collapsed-repository-folder-ids'

/** Loads the persisted set of collapsed folder IDs from local storage. */
export function loadCollapsedRepositoryFolderIDs() {
  return getNumberArray(CollapsedRepositoryFoldersKey)
}

/** Persists the current set of collapsed folder IDs to local storage. */
export function saveCollapsedRepositoryFolderIDs(
  collapsedFolderIDs: ReadonlyArray<number>
) {
  setNumberArray(CollapsedRepositoryFoldersKey, collapsedFolderIDs)
}

/**
 * Returns a new array with `folderID` added if it was absent, or removed if
 * it was already present (toggle semantics).
 */
export function toggleCollapsedRepositoryFolderID(
  collapsedFolderIDs: ReadonlyArray<number>,
  folderID: number
) {
  const nextCollapsedFolderIDs = new Set(collapsedFolderIDs)
  if (nextCollapsedFolderIDs.has(folderID)) {
    nextCollapsedFolderIDs.delete(folderID)
  } else {
    nextCollapsedFolderIDs.add(folderID)
  }

  return Array.from(nextCollapsedFolderIDs)
}

/**
 * Filters out any IDs from `collapsedFolderIDs` that no longer correspond to
 * an existing folder, keeping the persisted set in sync after a folder is
 * deleted.
 */
export function cleanupCollapsedRepositoryFolderIDs(
  collapsedFolderIDs: ReadonlyArray<number>,
  folders: ReadonlyArray<Folder>
) {
  const existingFolderIDs = new Set(folders.map(folder => folder.id))
  return collapsedFolderIDs.filter(id => existingFolderIDs.has(id))
}
