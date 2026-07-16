import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import {
  cleanupOpenRepositoryTabIDs,
  hasSavedOpenRepositoryTabIDs,
  loadOpenRepositoryTabIDs,
  reorderRepositoryTabIDs,
  saveOpenRepositoryTabIDs,
} from '../../src/lib/stores/helpers/open-repository-tabs-storage'
import { Repository } from '../../src/models/repository'

describe('open repository tabs storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips tab ids through localStorage', () => {
    assert.equal(hasSavedOpenRepositoryTabIDs(), false)
    saveOpenRepositoryTabIDs([3, 1, 2])
    assert.equal(hasSavedOpenRepositoryTabIDs(), true)
    assert.deepEqual(loadOpenRepositoryTabIDs(), [3, 1, 2])
  })

  it('distinguishes an intentionally empty tab list from missing storage', () => {
    saveOpenRepositoryTabIDs([])
    assert.equal(hasSavedOpenRepositoryTabIDs(), true)
    assert.deepEqual(loadOpenRepositoryTabIDs(), [])
  })

  it('filters missing and duplicate repository ids', () => {
    const repos = [
      new Repository('/a', 1, null, false),
      new Repository('/b', 2, null, false),
    ]
    assert.deepEqual(cleanupOpenRepositoryTabIDs([1, 3, 2, 1], repos), [1, 2])
  })

  it('reorders a tab before a target to its right', () => {
    assert.deepEqual(
      reorderRepositoryTabIDs([1, 2, 3, 4], 1, 3, 'before'),
      [2, 1, 3, 4]
    )
  })

  it('reorders a tab before a target on its left', () => {
    assert.deepEqual(
      reorderRepositoryTabIDs([1, 2, 3, 4], 4, 2, 'before'),
      [1, 4, 2, 3]
    )
  })

  it('reorders a tab after a target', () => {
    assert.deepEqual(
      reorderRepositoryTabIDs([1, 2, 3, 4], 1, 4, 'after'),
      [2, 3, 4, 1]
    )
  })

  it('does not reorder unknown or identical tabs', () => {
    assert.equal(reorderRepositoryTabIDs([1, 2], 3, 1, 'before'), null)
    assert.equal(reorderRepositoryTabIDs([1, 2], 1, 1, 'after'), null)
  })
})
