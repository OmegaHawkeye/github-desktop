import {
  RepositoriesDatabase,
  IDatabaseFolder,
  IDatabaseGitHubRepository,
  IDatabaseProtectedBranch,
  IDatabaseRepository,
  getOwnerKey,
} from '../databases/repositories-database'
import { Owner } from '../../models/owner'
import {
  GitHubRepository,
  GitHubRepositoryPermission,
} from '../../models/github-repository'
import {
  Repository,
  RepositoryWithGitHubRepository,
  assertIsRepositoryWithGitHubRepository,
  isRepositoryWithGitHubRepository,
} from '../../models/repository'
import { fatalError, assertNonNullable, forceUnwrap } from '../fatal-error'
import {
  IAPIRepository,
  IAPIBranch,
  IAPIFullRepository,
  GitHubAccountType,
} from '../api'
import { TypedBaseStore } from './base-store'
import { WorkflowPreferences } from '../../models/workflow-preferences'
import { clearTagsToPush } from './helpers/tags-to-push-storage'
import { IMatchedGitHubRepository } from '../repository-matching'
import { compare } from '../compare'
import { shallowEquals } from '../equality'
import { Folder } from '../../models/folder'

type AddRepositoryOptions = {
  missing?: boolean
  folderID?: number | null
}

/** The store for local repositories. */
export class RepositoriesStore extends TypedBaseStore<
  ReadonlyArray<Repository>
> {
  // Key-repo ID, Value-date
  private lastStashCheckCache = new Map<number, number>()

  /**
   * Key is the GitHubRepository id, value is the protected branch count reported
   * by the GitHub API.
   */
  private branchProtectionSettingsFoundCache = new Map<number, boolean>()

  /**
   * Key is the lookup by the GitHubRepository id and branch name, value is the
   * flag whether this branch is considered protected by the GitHub API
   */
  private protectionEnabledForBranchCache = new Map<string, boolean>()

  private emitQueued = false

  public constructor(private readonly db: RepositoriesDatabase) {
    super()
  }

  /**
   * Insert or update the GitHub repository database record based on the
   * provided API information while preserving any knowledge of the repository's
   * parent.
   *
   * See the documentation inside putGitHubRepository for more information but
   * the TL;DR is that if you've got an IAPIRepository you should use this
   * method and if you've got an IAPIFullRepository you should use
   * `upsertGitHubRepository`
   */
  public async upsertGitHubRepositoryLight(
    endpoint: string,
    apiRepository: IAPIRepository
  ) {
    return this.db.transaction(
      'rw',
      this.db.gitHubRepositories,
      this.db.owners,
      () => this._upsertGitHubRepository(endpoint, apiRepository, true)
    )
  }

  /**
   * Insert or update the GitHub repository database record based on the
   * provided API information
   */
  public async upsertGitHubRepository(
    endpoint: string,
    apiRepository: IAPIFullRepository
  ): Promise<GitHubRepository> {
    return this.db.transaction(
      'rw',
      this.db.gitHubRepositories,
      this.db.owners,
      () => this._upsertGitHubRepository(endpoint, apiRepository, false)
    )
  }

  private async toGitHubRepository(
    repo: IDatabaseGitHubRepository,
    owner?: Owner,
    parent?: GitHubRepository | null
  ): Promise<GitHubRepository> {
    assertNonNullable(repo.id, 'Need db id to create GitHubRepository')

    // Note the difference between parent being null and undefined. Null means
    // that the caller explicitly wants us to initialize a GitHubRepository
    // without a parent, undefined means we should try to dig it up.
    if (parent === undefined && repo.parentID !== null) {
      const dbParent = await this.db.gitHubRepositories.get(repo.parentID)
      assertNonNullable(dbParent, `Missing parent '${repo.id}'`)
      parent = await this.toGitHubRepository(dbParent)
    }

    if (owner === undefined) {
      const dbOwner = await this.db.owners.get(repo.ownerID)
      assertNonNullable(dbOwner, `Missing owner '${repo.ownerID}'`)
      owner = new Owner(
        dbOwner.login,
        dbOwner.endpoint,
        dbOwner.id!,
        dbOwner.type
      )
    }

    const ghRepo = new GitHubRepository(
      repo.name,
      owner,
      repo.id,
      repo.private,
      repo.htmlURL,
      repo.cloneURL,
      repo.issuesEnabled,
      repo.isArchived,
      repo.permissions,
      parent
    )

    // Dexie gets confused if we return a non-promise value (e.g. if this function
    // didn't need to await for the parent repo or the owner)
    return Promise.resolve(ghRepo)
  }

  private async toRepository(repo: IDatabaseRepository) {
    assertNonNullable(repo.id, "can't convert to Repository without id")
    return new Repository(
      repo.path,
      repo.id,
      repo.gitHubRepositoryID !== null
        ? await this.findGitHubRepositoryByID(repo.gitHubRepositoryID)
        : await Promise.resolve(null), // Dexie gets confused if we return null
      repo.missing,
      repo.alias,
      repo.workflowPreferences,
      repo.isTutorialRepository,
      repo.folderID ?? null
    )
  }

  private toFolder(folder: IDatabaseFolder) {
    assertNonNullable(folder.id, "can't convert to Folder without id")
    return new Folder(
      folder.id,
      folder.name,
      folder.sortOrder,
      folder.parentFolderID ?? null,
      folder.color ?? null
    )
  }

  /** Find a GitHub repository by its DB ID. */
  public async findGitHubRepositoryByID(
    id: number
  ): Promise<GitHubRepository | null> {
    const gitHubRepository = await this.db.gitHubRepositories.get(id)
    return gitHubRepository !== undefined
      ? this.toGitHubRepository(gitHubRepository)
      : Promise.resolve(null) // Dexie gets confused if we return null
  }

  /** Get all the local repositories. */
  public getAll(): Promise<ReadonlyArray<Repository>> {
    return this.db.transaction(
      'r',
      this.db.repositories,
      this.db.gitHubRepositories,
      this.db.owners,
      async () => {
        const repos = new Array<Repository>()

        for (const dbRepo of await this.db.repositories.toArray()) {
          assertNonNullable(dbRepo.id, 'no id after loading from db')
          repos.push(await this.toRepository(dbRepo))
        }

        return repos
      }
    )
  }

  /** Get all repository folders. */
  public async getAllFolders(): Promise<ReadonlyArray<Folder>> {
    const folders = await this.db.folders.toArray()
    folders.sort((a, b) => {
      const pa = a.parentFolderID ?? -1
      const pb = b.parentFolderID ?? -1
      if (pa !== pb) {
        return pa - pb
      }
      return a.sortOrder - b.sortOrder
    })
    return folders.map(folder => this.toFolder(folder))
  }

  /**
   * Add a tutorial repository.
   *
   * This method differs from the `addRepository` method in that it requires
   * that the repository has been created on the remote and set up to track it.
   * Given that tutorial repositories are created from the no-repositories blank
   * slate it shouldn't be possible for another repository with the same path to
   * exist but in case that changes in the future this method will set the
   * tutorial flag on the existing repository at the given path.
   */
  public async addTutorialRepository(
    path: string,
    endpoint: string,
    apiRepo: IAPIFullRepository
  ) {
    await this.db.transaction(
      'rw',
      this.db.repositories,
      this.db.gitHubRepositories,
      this.db.owners,
      async () => {
        const ghRepo = await this.upsertGitHubRepository(endpoint, apiRepo)
        const existingRepo = await this.db.repositories.get({ path })

        return await this.db.repositories.put({
          ...(existingRepo?.id !== undefined && { id: existingRepo.id }),
          path,
          alias: null,
          folderID: existingRepo?.folderID ?? null,
          gitHubRepositoryID: ghRepo.dbID,
          missing: false,
          lastStashCheckDate: null,
          isTutorialRepository: true,
        })
      }
    )

    this.emitUpdatedRepositories()
  }

  /**
   * Add a new local repository.
   *
   * If a repository already exists with that path, it will be returned instead.
   */
  public async addRepository(
    path: string,
    opts?: AddRepositoryOptions
  ): Promise<Repository> {
    const repository = await this.db.transaction(
      'rw',
      this.db.repositories,
      this.db.gitHubRepositories,
      this.db.owners,
      async () => {
        const existing = await this.db.repositories.get({ path })

        if (existing !== undefined) {
          return await this.toRepository(existing)
        }

        const dbRepo: IDatabaseRepository = {
          path,
          gitHubRepositoryID: null,
          missing: opts?.missing ?? false,
          lastStashCheckDate: null,
          alias: null,
          folderID: opts?.folderID ?? null,
        }
        const id = await this.db.repositories.add(dbRepo)
        return this.toRepository({ id, ...dbRepo })
      }
    )

    this.emitUpdatedRepositories()

    return repository
  }

  /** Remove the given repository. */
  public async removeRepository(repository: Repository): Promise<void> {
    await this.db.repositories.delete(repository.id)
    clearTagsToPush(repository)

    this.emitUpdatedRepositories()
  }

  /** Update the repository's `missing` flag. */
  public async updateRepositoryMissing(
    repository: Repository,
    missing: boolean
  ): Promise<Repository> {
    await this.db.repositories.update(repository.id, { missing })

    this.emitUpdatedRepositories()

    return new Repository(
      repository.path,
      repository.id,
      repository.gitHubRepository,
      missing,
      repository.alias,
      repository.workflowPreferences,
      repository.isTutorialRepository,
      repository.folderID
    )
  }

  /**
   * Update the alias for the specified repository.
   *
   * @param repository  The repository to update.
   * @param alias       The new alias to use.
   */
  public async updateRepositoryAlias(
    repository: Repository,
    alias: string | null
  ): Promise<void> {
    await this.db.repositories.update(repository.id, { alias })

    this.emitUpdatedRepositories()
  }

  /** Update the folder assignment for the specified repository. */
  public async updateRepositoryFolder(
    repository: Repository,
    folderID: number | null
  ): Promise<void> {
    await this.db.repositories.update(repository.id, { folderID })

    this.emitUpdatedRepositories()
  }

  /**
   * Update the workflow preferences for the specified repository.
   *
   * @param repository            The repository to update.
   * @param workflowPreferences   The object with the workflow settings to use.
   */
  public async updateRepositoryWorkflowPreferences(
    repository: Repository,
    workflowPreferences: WorkflowPreferences
  ): Promise<void> {
    await this.db.repositories.update(repository.id, { workflowPreferences })

    this.emitUpdatedRepositories()
  }

  /** Update the repository's path. */
  public async updateRepositoryPath(
    repository: Repository,
    path: string
  ): Promise<Repository> {
    await this.db.repositories.update(repository.id, { missing: false, path })

    this.emitUpdatedRepositories()

    return new Repository(
      path,
      repository.id,
      repository.gitHubRepository,
      false,
      repository.alias,
      repository.workflowPreferences,
      repository.isTutorialRepository,
      repository.folderID
    )
  }

  /** Create a new repository folder (optionally nested under `parentFolderID`). */
  public async createFolder(
    name: string,
    parentFolderID: number | null = null
  ): Promise<Folder> {
    const folder = await this.db.transaction(
      'rw',
      this.db.folders,
      async () => {
        await this.assertFolderNameUniqueAmongSiblings(name, parentFolderID)

        const all = await this.db.folders.toArray()
        const siblings = all.filter(
          f => (f.parentFolderID ?? null) === (parentFolderID ?? null)
        )
        const sortOrder =
          siblings.reduce((m, f) => Math.max(m, f.sortOrder), -1) + 1

        const id = await this.db.folders.add({
          name,
          sortOrder,
          parentFolderID: parentFolderID ?? null,
          color: null,
        })
        return new Folder(id, name, sortOrder, parentFolderID ?? null, null)
      }
    )

    this.emitUpdatedRepositories()

    return folder
  }

  /** Rename an existing repository folder. */
  public async renameFolder(folder: Folder, name: string): Promise<void> {
    await this.db.transaction('rw', this.db.folders, async () => {
      await this.assertFolderNameUniqueAmongSiblings(
        name,
        folder.parentFolderID,
        folder.id
      )
      await this.db.folders.update(folder.id, { name })
    })

    this.emitUpdatedRepositories()
  }

  /** Set (or clear, with `null`) the color of a repository folder. */
  public async setFolderColor(
    folder: Folder,
    color: string | null
  ): Promise<void> {
    await this.db.folders.update(folder.id, { color })
    this.emitUpdatedRepositories()
  }

  /** Persist a new ordering for repository folders that share the same parent. */
  public async reorderFolders(folders: ReadonlyArray<Folder>): Promise<void> {
    if (folders.length === 0) {
      return
    }

    const parent = folders[0].parentFolderID ?? null
    if (!folders.every(f => (f.parentFolderID ?? null) === parent)) {
      return fatalError(
        'reorderFolders can only reorder folders with the same parent'
      )
    }

    await this.db.transaction('rw', this.db.folders, async () => {
      await this.db.folders.bulkPut(
        folders.map((folder, index) => ({
          id: folder.id,
          name: folder.name,
          sortOrder: index,
          parentFolderID: folder.parentFolderID ?? null,
          color: folder.color ?? null,
        }))
      )
    })

    this.emitUpdatedRepositories()
  }

  /**
   * Move a folder under a new parent (end of sibling list), with cycle checks.
   */
  public async reparentFolder(
    folder: Folder,
    newParentFolderID: number | null
  ): Promise<void> {
    if (folder.id === newParentFolderID) {
      return
    }

    await this.db.transaction('rw', this.db.folders, async () => {
      const all = await this.db.folders.toArray()
      const byId = new Map(all.map(f => [f.id!, f]))

      if (
        newParentFolderID !== null &&
        this.newParentWouldBeInsideMovedFolder(
          byId,
          folder.id,
          newParentFolderID
        )
      ) {
        throw new Error('Cannot move a folder into itself or its descendant.')
      }

      await this.assertFolderNameUniqueAmongSiblings(
        folder.name,
        newParentFolderID,
        folder.id
      )

      const siblings = all.filter(
        f =>
          (f.parentFolderID ?? null) === (newParentFolderID ?? null) &&
          f.id !== folder.id
      )
      const sortOrder =
        siblings.reduce((m, f) => Math.max(m, f.sortOrder), -1) + 1

      await this.db.folders.update(folder.id, {
        parentFolderID: newParentFolderID,
        sortOrder,
      })
    })

    this.emitUpdatedRepositories()
  }

  /**
   * Move `moved` relative to `target`: before/after as siblings of `target`,
   * or into `target` as a child.
   */
  public async moveFolderRelativeTo(
    moved: Folder,
    target: Folder,
    position: 'before' | 'after' | 'into'
  ): Promise<void> {
    await this.db.transaction('rw', this.db.folders, async () => {
      const all = await this.db.folders.toArray()
      const byId = new Map(all.map(f => [f.id!, f]))

      if (position === 'into') {
        if (moved.id === target.id) {
          return
        }
        if (this.newParentWouldBeInsideMovedFolder(byId, moved.id, target.id)) {
          throw new Error('Cannot move a folder into itself or its descendant.')
        }
        await this.assertFolderNameUniqueAmongSiblings(
          moved.name,
          target.id,
          moved.id
        )
        const children = all.filter(
          f => (f.parentFolderID ?? null) === target.id
        )
        const sortOrder =
          children.reduce((m, f) => Math.max(m, f.sortOrder), -1) + 1
        await this.db.folders.update(moved.id, {
          parentFolderID: target.id,
          sortOrder,
        })
        return
      }

      const newParentId = target.parentFolderID ?? null
      if (
        newParentId !== null &&
        this.newParentWouldBeInsideMovedFolder(byId, moved.id, newParentId)
      ) {
        throw new Error('Cannot move a folder into itself or its descendant.')
      }

      await this.assertFolderNameUniqueAmongSiblings(
        moved.name,
        newParentId,
        moved.id
      )

      const siblings = all
        .filter(
          f =>
            (f.parentFolderID ?? null) === (newParentId ?? null) &&
            f.id !== moved.id
        )
        .sort((a, b) => compare(a.sortOrder, b.sortOrder))

      const targetIndex = siblings.findIndex(f => f.id === target.id)
      if (targetIndex === -1) {
        return
      }

      const insertIndex = position === 'before' ? targetIndex : targetIndex + 1

      const reordered = [...siblings]
      reordered.splice(insertIndex, 0, moved)

      for (let i = 0; i < reordered.length; i++) {
        const f = reordered[i]
        await this.db.folders.update(f.id!, {
          parentFolderID: newParentId,
          sortOrder: i,
        })
      }
    })

    this.emitUpdatedRepositories()
  }

  /**
   * Delete a repository folder. Its direct child folders and repositories are
   * lifted up to the deleted folder's parent (or to the top level if the folder
   * was itself top-level) so that nothing is orphaned unexpectedly.
   */
  public async deleteFolder(folder: Folder): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.folders,
      this.db.repositories,
      async () => {
        const newParentID = folder.parentFolderID ?? null

        // Lift direct child folders up to the deleted folder's parent.
        await this.db.folders
          .where('parentFolderID')
          .equals(folder.id)
          .modify({ parentFolderID: newParentID })

        // Move repositories in this folder to the parent folder.
        await this.db.repositories
          .where('folderID')
          .equals(folder.id)
          .modify({ folderID: newParentID })

        await this.db.folders.delete(folder.id)
      }
    )

    this.emitUpdatedRepositories()
  }

  /** True if `newParentFolderId` is the moved folder or nested under it. */
  private newParentWouldBeInsideMovedFolder(
    byId: Map<number, IDatabaseFolder>,
    folderBeingMovedId: number,
    newParentFolderId: number
  ): boolean {
    let id: number | null = newParentFolderId
    const seen = new Set<number>()
    while (id !== null) {
      if (id === folderBeingMovedId) {
        return true
      }
      if (seen.has(id)) {
        return false
      }
      seen.add(id)
      const row = byId.get(id)
      id = row?.parentFolderID ?? null
    }
    return false
  }

  private async assertFolderNameUniqueAmongSiblings(
    name: string,
    parentFolderID: number | null,
    exceptFolderId?: number
  ): Promise<void> {
    const all = await this.db.folders.toArray()
    const lower = name.toLowerCase()
    const conflict = all.some(
      f =>
        f.id !== exceptFolderId &&
        (f.parentFolderID ?? null) === (parentFolderID ?? null) &&
        f.name.toLowerCase() === lower
    )
    if (conflict) {
      throw new Error(
        'A folder with that name already exists in this location.'
      )
    }
  }

  /**
   * Sets the last time the repository was checked for stash entries
   *
   * @param repository The repository in which to update the last stash check date for
   * @param date The date and time in which the last stash check took place; defaults to
   * the current time
   */
  public async updateLastStashCheckDate(
    repository: Repository,
    date: number = Date.now()
  ): Promise<void> {
    await this.db.repositories.update(repository.id, {
      lastStashCheckDate: date,
    })

    this.lastStashCheckCache.set(repository.id, date)

    // this update doesn't affect the list (or its items) we emit from this store, so no need to `emitUpdatedRepositories`
  }

  /**
   * Gets the last time the repository was checked for stash entries
   *
   * @param repository The repository in which to update the last stash check date for
   */
  public async getLastStashCheckDate(
    repository: Repository
  ): Promise<number | null> {
    let lastCheckDate = this.lastStashCheckCache.get(repository.id) || null
    if (lastCheckDate !== null) {
      return lastCheckDate
    }

    const record = await this.db.repositories.get(repository.id)

    if (record === undefined) {
      return fatalError(
        `'getLastStashCheckDate' - unable to find repository with ID: ${repository.id}`
      )
    }

    lastCheckDate = record.lastStashCheckDate ?? null
    if (lastCheckDate !== null) {
      this.lastStashCheckCache.set(repository.id, lastCheckDate)
    }

    return lastCheckDate
  }

  private async putOwner(
    endpoint: string,
    login: string,
    ownerType?: GitHubAccountType
  ): Promise<Owner> {
    const key = getOwnerKey(endpoint, login)
    const existingOwner = await this.db.owners.get({ key })
    let id

    // Since we look up the owner based on a key which is the product of the
    // lowercased endpoint and login we know that we've found our match but it's
    // possible that the case differs (i.e we found `usera` but the actual login
    // is `userA`). In that case we want to update our database to persist the
    // login with the proper case.
    if (
      existingOwner === undefined ||
      existingOwner.login !== login ||
      // This is added so that we update existing owners with an undefined type.
      (ownerType !== undefined && existingOwner.type !== ownerType)
    ) {
      id = existingOwner?.id
      const existingId = id !== undefined ? { id } : {}
      id = await this.db.owners.put({
        ...existingId,
        key,
        endpoint,
        login,
        type: ownerType,
      })
    } else {
      id = forceUnwrap('Missing owner id', existingOwner.id)
    }

    return new Owner(login, endpoint, id, ownerType ?? existingOwner?.type)
  }

  public async upsertGitHubRepositoryFromMatch(
    match: IMatchedGitHubRepository
  ) {
    return await this.db.transaction(
      'rw',
      this.db.gitHubRepositories,
      this.db.owners,
      async () => {
        const { account } = match
        const owner = await this.putOwner(account.endpoint, match.owner)
        const existingRepo = await this.db.gitHubRepositories
          .where('[ownerID+name]')
          .equals([owner.id, match.name])
          .first()

        if (existingRepo) {
          return this.toGitHubRepository(existingRepo, owner)
        }

        const skeletonRepo: IDatabaseGitHubRepository = {
          cloneURL: null,
          htmlURL: null,
          lastPruneDate: null,
          name: match.name,
          ownerID: owner.id,
          parentID: null,
          private: null,
        }

        const id = await this.db.gitHubRepositories.put(skeletonRepo)
        return this.toGitHubRepository({ ...skeletonRepo, id }, owner, null)
      }
    )
  }

  public async setGitHubRepository(repo: Repository, ghRepo: GitHubRepository) {
    // If nothing has changed we can skip writing to the database and (more
    // importantly) avoid telling store consumers that the repo store has
    // changed and just return the repo that was given to us.
    if (isRepositoryWithGitHubRepository(repo)) {
      if (repo.gitHubRepository.hash === ghRepo.hash) {
        return repo
      }
    }

    await this.db.transaction('rw', this.db.repositories, () =>
      this.db.repositories.update(repo.id, { gitHubRepositoryID: ghRepo.dbID })
    )
    this.emitUpdatedRepositories()

    const updatedRepo = new Repository(
      repo.path,
      repo.id,
      ghRepo,
      repo.missing,
      repo.alias,
      repo.workflowPreferences,
      repo.isTutorialRepository,
      repo.folderID
    )

    assertIsRepositoryWithGitHubRepository(updatedRepo)
    return updatedRepo
  }

  private async _upsertGitHubRepository(
    endpoint: string,
    gitHubRepository: IAPIRepository | IAPIFullRepository,
    ignoreParent = false
  ): Promise<GitHubRepository> {
    const parent =
      'parent' in gitHubRepository && gitHubRepository.parent !== undefined
        ? await this._upsertGitHubRepository(
            endpoint,
            gitHubRepository.parent,
            true
          )
        : await Promise.resolve(null) // Dexie gets confused if we return null

    const { login, type } = gitHubRepository.owner
    const owner = await this.putOwner(endpoint, login, type)

    const existingRepo = await this.db.gitHubRepositories
      .where('[ownerID+name]')
      .equals([owner.id, gitHubRepository.name])
      .first()

    // If we can't resolve permissions for the current repository chances are
    // that it's because it's the parent repository of another repository and we
    // ended up here because the "actual" repository is trying to upsert its
    // parent. Since parent repository hashes don't include a permissions hash
    // and since it's possible that the user has both the fork and the parent
    // repositories in the app we don't want to overwrite the permissions hash
    // in the parent repository if we can help it or else we'll end up in a
    // perpetual race condition where updating the fork will clear the
    // permissions on the parent and updating the parent will reinstate them.
    const permissions =
      getPermissionsString(gitHubRepository) ??
      existingRepo?.permissions ??
      undefined

    // If we're told to ignore the parent then we'll attempt to use the existing
    // parent and if that fails set it to null. This happens when we want to
    // ensure we have a GitHubRepository record but we acquired the API data for
    // said repository from an API endpoint that doesn't include the parent
    // property like when loading pull requests. Similarly even when retrieving
    // a full API repository its parent won't be a full repo so we'll never know
    // if the parent of a repository has a parent (confusing, right?)
    //
    // We do all this to ensure that we only set the parent to null when we know
    // that it needs to be cleared. Otherwise we could have a scenario where
    // we've got a repository network where C is a fork of B and B is a fork of
    // A which is the root. If we attempt to upsert C without these checks in
    // place we'd wipe our knowledge of B being a fork of A.
    //
    // Since going from having a parent to not having a parent is incredibly
    // rare (deleting a forked repository and creating it from scratch again
    // with the same name or the parent getting deleted, etc) we assume that the
    // value we've got is valid until we're certain its not.
    const parentID = ignoreParent
      ? existingRepo?.parentID ?? null
      : parent?.dbID ?? null

    const updatedGitHubRepo: IDatabaseGitHubRepository = {
      ...(existingRepo?.id !== undefined && { id: existingRepo.id }),
      ownerID: owner.id,
      name: gitHubRepository.name,
      private: gitHubRepository.private,
      htmlURL: gitHubRepository.html_url,
      cloneURL: gitHubRepository.clone_url,
      parentID,
      lastPruneDate: existingRepo?.lastPruneDate ?? null,
      issuesEnabled: gitHubRepository.has_issues,
      isArchived: gitHubRepository.archived,
      permissions,
    }

    if (existingRepo !== undefined) {
      // If nothing has changed since the last time we persisted the API info
      // we can skip writing to the database and (more importantly) avoid
      // telling store consumers that the repo store has changed.
      if (shallowEquals(existingRepo, updatedGitHubRepo)) {
        return this.toGitHubRepository(existingRepo, owner, parent)
      }
    }

    const id = await this.db.gitHubRepositories.put(updatedGitHubRepo)
    this.emitUpdatedRepositories()
    return this.toGitHubRepository({ ...updatedGitHubRepo, id }, owner, parent)
  }

  /** Add or update the branch protections associated with a GitHub repository. */
  public async updateBranchProtections(
    gitHubRepository: GitHubRepository,
    protectedBranches: ReadonlyArray<IAPIBranch>
  ): Promise<void> {
    const dbID = gitHubRepository.dbID

    await this.db.transaction('rw', this.db.protectedBranches, async () => {
      // This update flow is organized into two stages:
      //
      // - update the in-memory cache
      // - update the underlying database state
      //
      // This should ensure any stale values are not being used, and avoids
      // the need to query the database while the results are in memory.

      const prefix = getKeyPrefix(dbID)

      for (const key of this.protectionEnabledForBranchCache.keys()) {
        // invalidate any cached entries belonging to this repository
        if (key.startsWith(prefix)) {
          this.protectionEnabledForBranchCache.delete(key)
        }
      }

      const branchRecords = protectedBranches.map<IDatabaseProtectedBranch>(
        b => ({ repoId: dbID, name: b.name })
      )

      // update cached values to avoid database lookup
      for (const item of branchRecords) {
        const key = getKey(dbID, item.name)
        this.protectionEnabledForBranchCache.set(key, true)
      }

      await this.db.protectedBranches.where('repoId').equals(dbID).delete()

      const protectionsFound = branchRecords.length > 0
      this.branchProtectionSettingsFoundCache.set(dbID, protectionsFound)

      if (branchRecords.length > 0) {
        await this.db.protectedBranches.bulkAdd(branchRecords)
      }
    })

    // this update doesn't affect the list (or its items) we emit from this store, so no need to `emitUpdatedRepositories`
  }

  /**
   * Set's the last time the repository was checked for pruning
   *
   * @param repository The repository in which to update the prune date for
   * @param date The date and time in which the last prune took place
   */
  public async updateLastPruneDate(
    repository: RepositoryWithGitHubRepository,
    date: number
  ): Promise<void> {
    await this.db.gitHubRepositories.update(repository.gitHubRepository.dbID, {
      lastPruneDate: date,
    })

    // this update doesn't affect the list (or its items) we emit from this store, so no need to `emitUpdatedRepositories`
  }

  public async getLastPruneDate(
    repository: RepositoryWithGitHubRepository
  ): Promise<number | null> {
    const id = repository.gitHubRepository.dbID
    const record = await this.db.gitHubRepositories.get(id)

    if (record === undefined) {
      return fatalError(`getLastPruneDate: No such GitHub repository: ${id}`)
    }

    return record.lastPruneDate
  }

  /**
   * Load the branch protection information for a repository from the database
   * and cache the results in memory
   */
  private async loadAndCacheBranchProtection(dbID: number) {
    // query the database to find any protected branches
    const branches = await this.db.protectedBranches
      .where('repoId')
      .equals(dbID)
      .toArray()

    const branchProtectionsFound = branches.length > 0
    this.branchProtectionSettingsFoundCache.set(dbID, branchProtectionsFound)

    // fill the retrieved records into the per-branch cache
    for (const branch of branches) {
      const key = getKey(dbID, branch.name)
      this.protectionEnabledForBranchCache.set(key, true)
    }

    return branchProtectionsFound
  }

  /**
   * Check if any branch protection settings are enabled for the repository
   * through the GitHub API.
   */
  public async hasBranchProtectionsConfigured(
    gitHubRepository: GitHubRepository
  ): Promise<boolean> {
    const branchProtectionsFound = this.branchProtectionSettingsFoundCache.get(
      gitHubRepository.dbID
    )

    if (branchProtectionsFound === undefined) {
      return this.loadAndCacheBranchProtection(gitHubRepository.dbID)
    }

    return branchProtectionsFound
  }

  /**
   * Helper method to emit updates consistently
   * (This is the only way we emit updates from this store.)
   */
  private emitUpdatedRepositories() {
    if (!this.emitQueued) {
      setImmediate(() => {
        this.getAll()
          .then(repos => this.emitUpdate(repos))
          .catch(e => log.error(`Failed emitting update`, e))
          .finally(() => (this.emitQueued = false))
      })
      this.emitQueued = true
    }
  }
}

/** Compute the key for the branch protection cache */
function getKey(dbID: number, branchName: string) {
  return `${getKeyPrefix(dbID)}${branchName}`
}

/** Compute the key prefix for the branch protection cache */
function getKeyPrefix(dbID: number) {
  return `${dbID}-`
}

function getPermissionsString(
  repo: IAPIRepository | IAPIFullRepository
): GitHubRepositoryPermission {
  const permissions = 'permissions' in repo ? repo.permissions : undefined

  if (permissions === undefined) {
    return null
  } else if (permissions.admin) {
    return 'admin'
  } else if (permissions.push) {
    return 'write'
  } else if (permissions.pull) {
    return 'read'
  } else {
    return null
  }
}
