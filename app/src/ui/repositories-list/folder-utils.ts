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
 * Returns the chain of colored folders from the outermost colored ancestor down
 * to (and including) `folder` itself when it is colored. Used to render nested
 * color "bands": one band per colored ancestor, outermost first (left-most).
 *
 * Example: a repo in a green subfolder inside a red folder yields `[red, green]`.
 */
export function getColoredFolderChain(
  folder: Folder,
  foldersByID: ReadonlyMap<number, Folder>
): ReadonlyArray<Folder> {
  const chain = new Array<Folder>()
  let current: Folder | undefined = folder
  const seen = new Set<number>()

  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.color !== null) {
      chain.push(current)
    }
    current =
      current.parentFolderID !== null && current.parentFolderID !== undefined
        ? foldersByID.get(current.parentFolderID)
        : undefined
  }

  // Walked from the folder up to the root, so reverse to get outermost first.
  return chain.reverse()
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
