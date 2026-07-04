import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  cleanupOpenRepositoryTabIDs,
  loadOpenRepositoryTabIDs,
  saveOpenRepositoryTabIDs,
} from '../../src/lib/stores/helpers/open-repository-tabs-storage'
import { Repository } from '../../src/models/repository'

describe('open repository tabs storage', () => {
  it('round-trips tab ids through localStorage', () => {
    saveOpenRepositoryTabIDs([3, 1, 2])
    assert.deepEqual(loadOpenRepositoryTabIDs(), [3, 1, 2])
  })

  it('filters tab ids to repositories that still exist', () => {
    const repos = [new Repository('/a', 1, null, false)]
    assert.deepEqual(cleanupOpenRepositoryTabIDs([1, 2, 3], repos), [1])
  })
})
