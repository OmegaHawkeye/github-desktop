import {
  Repository,
  ILocalRepositoryState,
  nameOf,
  isRepositoryWithGitHubRepository,
  RepositoryWithGitHubRepository,
} from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { getHTMLURL } from '../../lib/api'
import { caseInsensitiveCompare, compare } from '../../lib/compare'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { IAheadBehind } from '../../models/branch'
import { assertNever } from '../../lib/fatal-error'
import { isDotCom } from '../../lib/endpoint-capabilities'
import { Owner } from '../../models/owner'
import { Folder } from '../../models/folder'

export type RepositoryListGroup =
  | {
      kind: 'recent' | 'other'
    }
  | {
      kind: 'folder'
      folder: Folder
      /** Nesting depth (0 = root folder row). */
      depth: number
    }
  | {
      kind: 'dotcom'
      owner: Owner
    }
  | {
      kind: 'enterprise'
      host: string
    }

/**
 * Returns a unique grouping key (string) for a repository group. Doubles as a
 * case sensitive sorting key (i.e the case sensitive sort order of the keys is
 * the order in which the groups will be displayed in the repository list).
 */
export const getGroupKey = (group: RepositoryListGroup) => {
  const { kind } = group
  switch (kind) {
    case 'recent':
      return `0:recent`
    case 'folder':
      return `1:folder:${group.depth}:${group.folder.sortOrder
        .toString()
        .padStart(10, '0')}:${group.folder.id}`
    case 'dotcom':
      return `2:dotcom:${group.owner.login}`
    case 'enterprise':
      return `3:enterprise:${group.host}`
    case 'other':
      return `4:other`
    default:
      assertNever(group, `Unknown repository group kind ${group}`)
  }
}
export type Repositoryish = Repository | CloningRepository

export interface IRepositoryListItem extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
  readonly repository: Repositoryish
  readonly group: RepositoryListGroup
  readonly needsDisambiguation: boolean
  readonly aheadBehind: IAheadBehind | null
  readonly changedFilesCount: number
}

const recentRepositoriesThreshold = 7

const getHostForRepository = (repo: RepositoryWithGitHubRepository) =>
  new URL(getHTMLURL(repo.gitHubRepository.endpoint)).host

function folderDepth(
  folder: Folder,
  foldersByID: ReadonlyMap<number, Folder>
): number {
  let d = 0
  let pid: number | null = folder.parentFolderID
  while (pid !== null) {
    d++
    const p = foldersByID.get(pid)
    if (p === undefined) {
      break
    }
    pid = p.parentFolderID
  }
  return d
}

/** Depth-first pre-order of folders (roots first, then children by sortOrder). */
export function getFoldersInTreeOrder(
  folders: ReadonlyArray<Folder>
): ReadonlyArray<Folder> {
  const byParent = new Map<number | null, Folder[]>()
  for (const f of folders) {
    const p = f.parentFolderID ?? null
    let list = byParent.get(p)
    if (list === undefined) {
      list = []
      byParent.set(p, list)
    }
    list.push(f)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => compare(a.sortOrder, b.sortOrder))
  }

  const result: Folder[] = []
  const walk = (parentId: number | null) => {
    const children = byParent.get(parentId) ?? []
    for (const child of children) {
      result.push(child)
      walk(child.id)
    }
  }
  walk(null)
  return result
}

/** A folder label that includes its ancestors for disambiguation. */
export function getFolderPathLabel(
  folder: Folder,
  folders: ReadonlyArray<Folder>
): string {
  const foldersByID = new Map(folders.map(candidate => [candidate.id, candidate]))
  const names = [folder.name]
  const seen = new Set<number>([folder.id])
  let parentID = folder.parentFolderID

  while (parentID !== null && !seen.has(parentID)) {
    seen.add(parentID)
    const parent = foldersByID.get(parentID)
    if (parent === undefined) {
      break
    }
    names.unshift(parent.name)
    parentID = parent.parentFolderID
  }

  return names.join(' / ')
}

const getGroupForRepository = (
  repo: Repositoryish,
  foldersByID: ReadonlyMap<number, Folder>
): RepositoryListGroup => {
  if (repo instanceof Repository && repo.folderID !== null) {
    const folder = foldersByID.get(repo.folderID)
    if (folder !== undefined) {
      const depth = folderDepth(folder, foldersByID)
      return { kind: 'folder', folder, depth }
    }
  }

  if (repo instanceof Repository && isRepositoryWithGitHubRepository(repo)) {
    return isDotCom(repo.gitHubRepository.endpoint)
      ? { kind: 'dotcom', owner: repo.gitHubRepository.owner }
      : { kind: 'enterprise', host: getHostForRepository(repo) }
  }
  return { kind: 'other' }
}

type RepoGroupItem = { group: RepositoryListGroup; repos: Repositoryish[] }

function groupsMatchForDisambiguation(
  a: RepositoryListGroup,
  b: RepositoryListGroup
): boolean {
  if (a === b) {
    return true
  }
  if (a.kind === 'folder' && b.kind === 'folder') {
    return a.folder.id === b.folder.id
  }
  return false
}

export function groupRepositories(
  repositories: ReadonlyArray<Repositoryish>,
  folders: ReadonlyArray<Folder>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  recentRepositories: ReadonlyArray<number>
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  const includeRecentGroup = repositories.length > recentRepositoriesThreshold
  const recentSet = includeRecentGroup ? new Set(recentRepositories) : undefined
  const groups = new Map<string, RepoGroupItem>()
  const foldersByID = new Map(folders.map(folder => [folder.id, folder]))

  const addToGroup = (group: RepositoryListGroup, repo: Repositoryish) => {
    const key = getGroupKey(group)
    let rg = groups.get(key)
    if (!rg) {
      rg = { group, repos: [] }
      groups.set(key, rg)
    }

    rg.repos.push(repo)
  }

  for (const folder of getFoldersInTreeOrder(folders)) {
    const depth = folderDepth(folder, foldersByID)
    const g: RepositoryListGroup = { kind: 'folder', folder, depth }
    const key = getGroupKey(g)
    if (!groups.has(key)) {
      groups.set(key, { group: g, repos: [] })
    }
  }

  for (const repo of repositories) {
    if (recentSet?.has(repo.id) && repo instanceof Repository) {
      addToGroup({ kind: 'recent' }, repo)
    }

    addToGroup(getGroupForRepository(repo, foldersByID), repo)
  }

  const output: Array<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  > = []

  if (includeRecentGroup) {
    const recentKey = getGroupKey({ kind: 'recent' })
    const recentRg = groups.get(recentKey)
    if (recentRg !== undefined) {
      output.push({
        identifier: { kind: 'recent' },
        items: toSortedListItems(
          { kind: 'recent' },
          recentRg.repos,
          localRepositoryStateLookup,
          groups
        ),
      })
    }
  }

  for (const folder of getFoldersInTreeOrder(folders)) {
    const depth = folderDepth(folder, foldersByID)
    const g: RepositoryListGroup = { kind: 'folder', folder, depth }
    const key = getGroupKey(g)
    const rg = groups.get(key)
    if (rg !== undefined) {
      output.push({
        identifier: g,
        items: toSortedListItems(
          g,
          rg.repos,
          localRepositoryStateLookup,
          groups
        ),
      })
    }
  }

  const dotcomKeys = Array.from(groups.keys())
    .filter(k => k.startsWith('2:dotcom'))
    .sort(compare)
  for (const key of dotcomKeys) {
    const rg = groups.get(key)
    if (rg !== undefined) {
      output.push({
        identifier: rg.group,
        items: toSortedListItems(
          rg.group,
          rg.repos,
          localRepositoryStateLookup,
          groups
        ),
      })
    }
  }

  const enterpriseKeys = Array.from(groups.keys())
    .filter(k => k.startsWith('3:enterprise'))
    .sort(compare)
  for (const key of enterpriseKeys) {
    const rg = groups.get(key)
    if (rg !== undefined) {
      output.push({
        identifier: rg.group,
        items: toSortedListItems(
          rg.group,
          rg.repos,
          localRepositoryStateLookup,
          groups
        ),
      })
    }
  }

  const otherKey = getGroupKey({ kind: 'other' })
  const otherRg = groups.get(otherKey)
  if (otherRg !== undefined) {
    output.push({
      identifier: { kind: 'other' },
      items: toSortedListItems(
        { kind: 'other' },
        otherRg.repos,
        localRepositoryStateLookup,
        groups
      ),
    })
  }

  return output
}

// Returns the display title for a repository, which is either the alias
// (if available) or the name.
const getDisplayTitle = (r: Repositoryish) =>
  r instanceof Repository && r.alias != null ? r.alias : r.name

const toSortedListItems = (
  group: RepositoryListGroup,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  groups: Map<string, RepoGroupItem>
): IRepositoryListItem[] => {
  const groupNames = new Map<string, number>()
  const allNames = new Map<string, number>()

  for (const groupItem of groups.values()) {
    // All items in the recent group are by definition present in another
    // group and therefore we don't want to count them.
    if (groupItem.group.kind === 'recent') {
      continue
    }

    for (const title of groupItem.repos.map(getDisplayTitle)) {
      allNames.set(title, (allNames.get(title) ?? 0) + 1)
      if (groupsMatchForDisambiguation(groupItem.group, group)) {
        groupNames.set(title, (groupNames.get(title) ?? 0) + 1)
      }
    }
  }

  return repositories
    .map(r => {
      const repoState = localRepositoryStateLookup.get(r.id)
      const title = getDisplayTitle(r)

      return {
        text: r instanceof Repository ? [title, nameOf(r)] : [title],
        id: r.id.toString(),
        repository: r,
        group,
        needsDisambiguation:
          // If the repository is in the enterprise group and has a duplicate
          // name in the group, we need to disambiguate it. We don't have to
          // disambiguate repositories in the 'dotcom' group because they are
          // already grouped by owner. If the repository is in the 'recent'
          // group and has a duplicate name in any group, we need to
          // disambiguate it.
          ((groupNames.get(title) ?? 0) > 1 &&
            (group.kind === 'enterprise' || group.kind === 'folder')) ||
          ((allNames.get(title) ?? 0) > 1 && group.kind === 'recent'),
        aheadBehind: repoState?.aheadBehind ?? null,
        changedFilesCount: repoState?.changedFilesCount ?? 0,
      }
    })
    .sort(({ repository: x }, { repository: y }) =>
      caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
    )
}
