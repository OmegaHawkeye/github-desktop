import { getNumberArray, setNumberArray } from '../../local-storage'
import { Repository } from '../../../models/repository'

export const OpenRepositoryTabsKey = 'open-repository-tab-ids'

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
  return openTabIds.filter(id => validIds.has(id))
}
