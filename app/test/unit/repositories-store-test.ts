import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { RepositoriesStore } from '../../src/lib/stores/repositories-store'
import { TestRepositoriesDatabase } from '../helpers/databases'
import { IAPIFullRepository, getDotComAPIEndpoint } from '../../src/lib/api'
import { assertIsRepositoryWithGitHubRepository } from '../../src/models/repository'

describe('RepositoriesStore', () => {
  let repoDb = new TestRepositoriesDatabase()
  let repositoriesStore = new RepositoriesStore(repoDb)

  beforeEach(async () => {
    repoDb = new TestRepositoriesDatabase()
    await repoDb.reset()
    repositoriesStore = new RepositoriesStore(repoDb)
  })

  describe('adding a new repository', () => {
    it('contains the added repository', async () => {
      const repoPath = '/some/cool/path'
      await repositoriesStore.addRepository(repoPath)

      const repositories = await repositoriesStore.getAll()
      assert.equal(repositories[0].path, repoPath)
    })
  })

  describe('getting all repositories', () => {
    it('returns multiple repositories', async () => {
      await repositoriesStore.addRepository('/some/cool/path')
      await repositoriesStore.addRepository('/some/other/path')

      const repositories = await repositoriesStore.getAll()
      assert.equal(repositories.length, 2)
    })
  })

  describe('repository folders', () => {
    it('creates folders and assigns a repository to one', async () => {
      const folder = await repositoriesStore.createFolder('Work')
      const repository = await repositoriesStore.addRepository(
        '/some/cool/path'
      )

      await repositoriesStore.updateRepositoryFolder(repository, folder.id)

      const folders = await repositoriesStore.getAllFolders()
      const repositories = await repositoriesStore.getAll()

      assert.equal(folders.length, 1)
      assert.equal(folders[0].name, 'Work')
      assert.equal(repositories[0].folderID, folder.id)
    })

    it('persists reordered folder sort order without changing assignments', async () => {
      const workFolder = await repositoriesStore.createFolder('Work')
      const personalFolder = await repositoriesStore.createFolder('Personal')
      await repositoriesStore.addRepository('/some/cool/path', {
        folderID: workFolder.id,
      })

      await repositoriesStore.reorderFolders([personalFolder, workFolder])

      const folders = await repositoriesStore.getAllFolders()
      const repositories = await repositoriesStore.getAll()

      assert.deepEqual(
        folders.map(folder => ({
          id: folder.id,
          name: folder.name,
          sortOrder: folder.sortOrder,
        })),
        [
          { id: personalFolder.id, name: 'Personal', sortOrder: 0 },
          { id: workFolder.id, name: 'Work', sortOrder: 1 },
        ]
      )
      assert.equal(repositories[0].folderID, workFolder.id)
    })

    it('removes folder assignments when deleting a folder', async () => {
      const folder = await repositoriesStore.createFolder('Work')
      const repository = await repositoriesStore.addRepository(
        '/some/cool/path',
        {
          folderID: folder.id,
        }
      )

      await repositoriesStore.deleteFolder(folder)

      const folders = await repositoriesStore.getAllFolders()
      const repositories = await repositoriesStore.getAll()

      assert.equal(folders.length, 0)
      assert.equal(repositories[0].folderID, null)
      assert.equal(repositories[0].id, repository.id)
    })

    it('removes nested folders and all descendant assignments', async () => {
      const parent = await repositoriesStore.createFolder('Parent')
      const child = await repositoriesStore.createFolder('Child', parent.id)
      await repositoriesStore.addRepository('/parent/repo', {
        folderID: parent.id,
      })
      await repositoriesStore.addRepository('/child/repo', {
        folderID: child.id,
      })

      await repositoriesStore.deleteFolder(parent)

      assert.deepEqual(await repositoriesStore.getAllFolders(), [])
      assert.deepEqual(
        (await repositoriesStore.getAll()).map(repository => repository.folderID),
        [null, null]
      )
    })

    it('rejects moves that create duplicate sibling names', async () => {
      const parent = await repositoriesStore.createFolder('Parent')
      await repositoriesStore.createFolder('Personal', parent.id)
      const moved = await repositoriesStore.createFolder('Personal')

      await assert.rejects(
        repositoriesStore.moveFolderRelativeTo(moved, parent, 'into'),
        /already exists/
      )

      const persistedMoved = (await repositoriesStore.getAllFolders()).find(
        folder => folder.id === moved.id
      )
      assert.equal(persistedMoved?.parentFolderID, null)
    })

    it('rejects moving a folder into its descendant', async () => {
      const parent = await repositoriesStore.createFolder('Parent')
      const child = await repositoriesStore.createFolder('Child', parent.id)

      await assert.rejects(
        repositoriesStore.moveFolderRelativeTo(parent, child, 'into'),
        /descendant/
      )
    })
  })

  describe('updating a GitHub repository', () => {
    const apiRepo: IAPIFullRepository = {
      clone_url: 'https://github.com/my-user/my-repo',
      ssh_url: 'git@github.com:my-user/my-repo.git',
      html_url: 'https://github.com/my-user/my-repo',
      name: 'my-repo',
      owner: {
        id: 42,
        html_url: 'https://github.com/my-user',
        login: 'my-user',
        avatar_url: 'https://github.com/my-user.png',
        type: 'User',
      },
      private: true,
      fork: false,
      default_branch: 'master',
      pushed_at: '1995-12-17T03:24:00',
      has_issues: true,
      archived: false,
      permissions: {
        pull: true,
        push: true,
        admin: false,
      },
      parent: undefined,
    }
    const endpoint = getDotComAPIEndpoint()

    it('adds a new GitHub repository', async () => {
      await repositoriesStore.setGitHubRepository(
        await repositoriesStore.addRepository('/some/cool/path'),
        await repositoriesStore.upsertGitHubRepository(endpoint, apiRepo)
      )

      const repositories = await repositoriesStore.getAll()
      const repo = repositories[0]
      assertIsRepositoryWithGitHubRepository(repo)
      assert(repo.gitHubRepository.isPrivate)
      assert(!repo.gitHubRepository.fork)
      assert.equal(
        repo.gitHubRepository.htmlURL,
        'https://github.com/my-user/my-repo'
      )
    })

    it('reuses an existing GitHub repository', async () => {
      const firstRepo = await repositoriesStore.setGitHubRepository(
        await repositoriesStore.addRepository('/some/cool/path'),
        await repositoriesStore.upsertGitHubRepository(endpoint, apiRepo)
      )

      const secondRepo = await repositoriesStore.setGitHubRepository(
        await repositoriesStore.addRepository('/some/other/path'),
        await repositoriesStore.upsertGitHubRepository(endpoint, apiRepo)
      )

      assert.equal(
        firstRepo.gitHubRepository.dbID,
        secondRepo.gitHubRepository.dbID
      )
    })
  })
})
