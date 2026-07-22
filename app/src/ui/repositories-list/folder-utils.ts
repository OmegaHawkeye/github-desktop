import { Folder } from '../../models/folder'

/**
 * Returns true if `candidateID` is the same folder as `ancestorID` or is
 * nested anywhere beneath it in the folder tree. Used to prevent a folder
 * from being dropped into itself or one of its own descendants.
 */
export function isFolderSelfOrDescendant(
  candidateID: number,
  ancestorID: number,
  foldersByID: ReadonlyMap<number, Folder>
): boolean {
  let id: number | null = candidateID
  const seen = new Set<number>()
  while (id !== null && !seen.has(id)) {
    if (id === ancestorID) {
      return true
    }
    seen.add(id)
    id = foldersByID.get(id)?.parentFolderID ?? null
  }
  return false
}

/**
 * Returns true if any ancestor of `folder` is present in
 * `collapsedIDSet`, meaning the folder should not be rendered because a
 * parent is collapsed.
 */
export function isFolderHiddenByCollapsedAncestor(
  folder: Folder,
  foldersByID: ReadonlyMap<number, Folder>,
  collapsedIDSet: ReadonlySet<number>
): boolean {
  let pid: number | null = folder.parentFolderID
  const seen = new Set<number>()
  while (pid !== null && !seen.has(pid)) {
    if (collapsedIDSet.has(pid)) {
      return true
    }
    seen.add(pid)
    pid = foldersByID.get(pid)?.parentFolderID ?? null
  }
  return false
}
