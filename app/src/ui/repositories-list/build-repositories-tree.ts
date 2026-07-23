import { Folder } from '../../models/folder'
import { ILocalRepositoryState } from '../../models/repository'
import { match, IMatch, IMatches } from '../../lib/fuzzy-find'
import {
  groupRepositories,
  IRepositoryListItem,
  RepositoryListGroup,
  Repositoryish,
} from './group-repositories'

/** A repository row in the tree, with its fuzzy-match highlight ranges. */
export interface IRepositoryTreeItem {
  readonly item: IRepositoryListItem
  readonly matches: IMatches
}

/** A folder node that literally contains its child folders and repositories. */
export interface IRepositoryTreeFolder {
  readonly folder: Folder
  readonly depth: number
  readonly items: ReadonlyArray<IRepositoryTreeItem>
  readonly children: ReadonlyArray<IRepositoryTreeFolder>
}

/** A flat, non-folder section (recent / dotcom / enterprise / other). */
export interface IRepositoryTreeSection {
  readonly group: RepositoryListGroup
  readonly items: ReadonlyArray<IRepositoryTreeItem>
}

/**
 * The repository sidebar rendered as a tree: a "recent" section, the folder
 * hierarchy (each folder wrapping its subfolders + repos), and the remaining
 * flat sections for repositories that don't live in a folder.
 */
export interface IRepositoriesTree {
  readonly recent: IRepositoryTreeSection | null
  readonly folders: ReadonlyArray<IRepositoryTreeFolder>
  readonly otherSections: ReadonlyArray<IRepositoryTreeSection>
}

const getText = (item: IRepositoryListItem): ReadonlyArray<string> => item.text

/**
 * Fuzzy-match a group's items against the filter (mirrors SectionFilterList).
 * An empty filter returns every item with empty highlight ranges.
 */
function matchItems(
  filter: string,
  items: ReadonlyArray<IRepositoryListItem>
): ReadonlyArray<IRepositoryTreeItem> {
  const matched: ReadonlyArray<IMatch<IRepositoryListItem>> = filter
    ? match(filter, items, getText)
    : items.map(item => ({
        score: 1,
        matches: { title: [], subtitle: [] },
        item,
      }))

  return matched.map(m => ({ item: m.item, matches: m.matches }))
}

const folderMatchesFilter = (folder: Folder, filter: string): boolean =>
  filter.length === 0 || folder.name.toLowerCase().includes(filter)

/**
 * Builds the nested repository tree. Reuses `groupRepositories` for all the
 * per-repository work (disambiguation, ahead/behind, changed files, sorting)
 * and reshapes the flat folder groups into a real tree by `parentFolderID`.
 * Applies fuzzy filtering: a folder stays visible when it matches by name, has
 * a matching repository, or has any visible descendant folder.
 */
export function buildRepositoriesTree(
  repositories: ReadonlyArray<Repositoryish>,
  folders: ReadonlyArray<Folder>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  recentRepositories: ReadonlyArray<number>,
  filterText: string
): IRepositoriesTree {
  const filter = (filterText || '').toLowerCase()
  const isFiltering = filter.length > 0

  const groups = groupRepositories(
    repositories,
    folders,
    localRepositoryStateLookup,
    recentRepositories
  )

  // Split the flat groups: index folder groups by folder id, collect the rest.
  const folderItems = new Map<number, ReadonlyArray<IRepositoryListItem>>()
  let recent: IRepositoryTreeSection | null = null
  const otherSections = new Array<IRepositoryTreeSection>()

  for (const group of groups) {
    const id = group.identifier
    if (id.kind === 'folder') {
      folderItems.set(id.folder.id, group.items)
      continue
    }

    const items = matchItems(filter, group.items)
    if (items.length === 0) {
      continue
    }

    if (id.kind === 'recent') {
      recent = { group: id, items }
    } else {
      otherSections.push({ group: id, items })
    }
  }

  // Group folders by parent (sorted by sortOrder) for recursive assembly.
  const byParent = new Map<number | null, Folder[]>()
  for (const folder of folders) {
    const parent = folder.parentFolderID ?? null
    const list = byParent.get(parent) ?? []
    list.push(folder)
    byParent.set(parent, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const foldersByID = new Map(folders.map(f => [f.id, f]))
  const depthOf = (folder: Folder): number => {
    let depth = 0
    let parentID = folder.parentFolderID
    const seen = new Set<number>()
    while (parentID != null && !seen.has(parentID)) {
      seen.add(parentID)
      depth++
      parentID = foldersByID.get(parentID)?.parentFolderID ?? null
    }
    return depth
  }

  const buildFolder = (folder: Folder): IRepositoryTreeFolder | null => {
    const items = matchItems(filter, folderItems.get(folder.id) ?? [])
    const children = (byParent.get(folder.id) ?? [])
      .map(buildFolder)
      .filter((node): node is IRepositoryTreeFolder => node !== null)

    if (
      isFiltering &&
      !folderMatchesFilter(folder, filter) &&
      items.length === 0 &&
      children.length === 0
    ) {
      return null
    }

    return { folder, depth: depthOf(folder), items, children }
  }

  const topFolders = (byParent.get(null) ?? [])
    .map(buildFolder)
    .filter((node): node is IRepositoryTreeFolder => node !== null)

  return { recent, folders: topFolders, otherSections }
}
