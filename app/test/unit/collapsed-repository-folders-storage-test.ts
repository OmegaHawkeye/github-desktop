import { describe, it } from 'node:test'
import assert from 'node:assert'

import { Folder } from '../../src/models/folder'
import {
  cleanupCollapsedRepositoryFolderIDs,
  loadCollapsedRepositoryFolderIDs,
  saveCollapsedRepositoryFolderIDs,
  toggleCollapsedRepositoryFolderID,
} from '../../src/lib/stores/helpers/collapsed-repository-folders-storage'

describe('collapsed repository folders storage', () => {
  it('loads ids that were saved to localStorage', () => {
    saveCollapsedRepositoryFolderIDs([2, 4])

    assert.deepEqual(loadCollapsedRepositoryFolderIDs(), [2, 4])
  })

  it('toggles folder ids in the collapsed set', () => {
    assert.deepEqual(toggleCollapsedRepositoryFolderID([], 2), [2])
    assert.deepEqual(toggleCollapsedRepositoryFolderID([2, 4], 2), [4])
  })

  it('removes ids for folders that no longer exist', () => {
    const folders = [new Folder(1, 'Work', 0), new Folder(3, 'Team', 1)]

    assert.deepEqual(
      cleanupCollapsedRepositoryFolderIDs([1, 2, 3], folders),
      [1, 3]
    )
  })
})
