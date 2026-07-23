import { compare } from '../../lib/compare'
import { Folder } from '../../models/folder'
import { Repository } from '../../models/repository'
import { Repositoryish } from './group-repositories'

export type FolderDropPosition = 'before' | 'after' | 'into'

export function getFolderDropPosition(
  bounds: Pick<DOMRect, 'top' | 'height'>,
  clientY: number
): FolderDropPosition {
  const y = clientY - bounds.top
  const h = bounds.height
  if (h <= 0) {
    return 'into'
  }
  if (y < h * 0.3) {
    return 'before'
  }
  if (y > h * 0.7) {
    return 'after'
  }
  return 'into'
}

export function canDropRepositoryIntoFolder(
  repository: Repository,
  folder: Folder
) {
  return repository.folderID !== folder.id
}

/**
 * Given the repository being dragged and the current multi-selection, decide
 * which repositories should be moved. When the dragged repository is part of
 * the multi-selection, all selected (real) repositories move together;
 * otherwise only the dragged repository moves.
 */
export function resolveRepositoriesToMove(
  repositories: ReadonlyArray<Repositoryish>,
  multiSelectedRepositoryIDs: ReadonlyArray<number>,
  dragged: Repository
): ReadonlyArray<Repository> {
  if (!multiSelectedRepositoryIDs.includes(dragged.id)) {
    return [dragged]
  }

  const ids = new Set(multiSelectedRepositoryIDs)
  return repositories.filter(
    (r): r is Repository => r instanceof Repository && ids.has(r.id)
  )
}

/**
 * Reorder siblings of `draggedFolder` relative to `targetFolder`.
 * Returns the new sibling list with sequential `sortOrder` values.
 */
export function getReorderedFolders(
  allFolders: ReadonlyArray<Folder>,
  draggedFolder: Folder,
  targetFolder: Folder,
  position: Exclude<FolderDropPosition, 'into'>
): ReadonlyArray<Folder> {
  if (draggedFolder.id === targetFolder.id) {
    return []
  }

  const parentId = draggedFolder.parentFolderID ?? null
  if ((targetFolder.parentFolderID ?? null) !== parentId) {
    return []
  }

  const siblings = allFolders
    .filter(f => (f.parentFolderID ?? null) === (parentId ?? null))
    .sort((a, b) => compare(a.sortOrder, b.sortOrder))

  const draggedIndex = siblings.findIndex(f => f.id === draggedFolder.id)
  const targetIndex = siblings.findIndex(f => f.id === targetFolder.id)

  if (draggedIndex === -1 || targetIndex === -1) {
    return []
  }

  const reordered = siblings.slice()
  const [removed] = reordered.splice(draggedIndex, 1)
  const targetIndexAfterRemoval =
    targetIndex - (draggedIndex < targetIndex ? 1 : 0)
  const insertIndex =
    targetIndexAfterRemoval + (position === 'after' ? 1 : 0)

  reordered.splice(insertIndex, 0, removed)

  return reordered.map(
    (f, index) =>
      new Folder(f.id, f.name, index, f.parentFolderID ?? null, f.color ?? null)
  )
}
