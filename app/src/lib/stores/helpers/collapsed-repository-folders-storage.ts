import { getNumberArray, setNumberArray } from '../../local-storage'
import { Folder } from '../../../models/folder'

export const CollapsedRepositoryFoldersKey = 'collapsed-repository-folder-ids'

export function loadCollapsedRepositoryFolderIDs() {
  return getNumberArray(CollapsedRepositoryFoldersKey)
}

export function saveCollapsedRepositoryFolderIDs(
  collapsedFolderIDs: ReadonlyArray<number>
) {
  setNumberArray(CollapsedRepositoryFoldersKey, collapsedFolderIDs)
}

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

export function cleanupCollapsedRepositoryFolderIDs(
  collapsedFolderIDs: ReadonlyArray<number>,
  folders: ReadonlyArray<Folder>
) {
  const existingFolderIDs = new Set(folders.map(folder => folder.id))
  return collapsedFolderIDs.filter(id => existingFolderIDs.has(id))
}
