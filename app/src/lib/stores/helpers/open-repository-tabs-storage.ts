import { getNumberArray, setNumberArray } from '../../local-storage'
import { Repository } from '../../../models/repository'

export const OpenRepositoryTabsKey = 'open-repository-tab-ids'

export function hasSavedOpenRepositoryTabIDs(): boolean {
  return localStorage.getItem(OpenRepositoryTabsKey) !== null
}

export function loadOpenRepositoryTabIDs(): ReadonlyArray<number> {
  return getNumberArray(OpenRepositoryTabsKey)
}

export function saveOpenRepositoryTabIDs(
  repositoryIds: ReadonlyArray<number>
): void {
  setNumberArray(OpenRepositoryTabsKey, repositoryIds)
}

export function cleanupOpenRepositoryTabIDs(
  openTabIds: ReadonlyArray<number>,
  repositories: ReadonlyArray<Repository>
): ReadonlyArray<number> {
  const validIds = new Set(repositories.map(r => r.id))
  const seenIds = new Set<number>()
  return openTabIds.filter(id => {
    if (!validIds.has(id) || seenIds.has(id)) {
      return false
    }

    seenIds.add(id)
    return true
  })
}

export function reorderRepositoryTabIDs(
  openTabIds: ReadonlyArray<number>,
  draggedRepositoryId: number,
  targetRepositoryId: number,
  position: 'before' | 'after'
): ReadonlyArray<number> | null {
  const from = openTabIds.indexOf(draggedRepositoryId)
  if (
    from === -1 ||
    !openTabIds.includes(targetRepositoryId) ||
    draggedRepositoryId === targetRepositoryId
  ) {
    return null
  }

  const next = [...openTabIds]
  const [draggedRepository] = next.splice(from, 1)
  const targetIndex = next.indexOf(targetRepositoryId)
  const insertionIndex = targetIndex + (position === 'after' ? 1 : 0)
  next.splice(insertionIndex, 0, draggedRepository)
  return next
}
