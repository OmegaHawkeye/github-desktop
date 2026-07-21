import { RowIndexPath } from '../ui/lib/list/list-row-index-path'
import { Commit } from './commit'
import { Folder } from './folder'
import { GitHubRepository } from './github-repository'
import { Repository } from './repository'

/**
 * This is a type is used in conjunction with the drag and drop manager to
 * store and specify the types of data that are being dragged
 *
 * Thus, using a `|` here would allow us to specify multiple types of data that
 * can be dragged.
 */
export type DragData =
  | CommitDragData
  | RepositoryDragData
  | RepositoryFolderDragData

export type CommitDragData = {
  type: DragType.Commit
  commits: ReadonlyArray<Commit>
}

export type RepositoryDragData = {
  type: DragType.Repository
  repository: Repository
}

export type RepositoryFolderDragData = {
  type: DragType.RepositoryFolder
  folder: Folder
}

export enum DragType {
  Commit,
  Repository,
  RepositoryFolder,
}

export type DragElement =
  | {
      type: DragType.Commit
      commit: Commit
      selectedCommits: ReadonlyArray<Commit>
      gitHubRepository: GitHubRepository | null
    }
  | {
      type: DragType.Repository
      repository: Repository
    }
  | {
      type: DragType.RepositoryFolder
      folder: Folder
    }

export enum DropTargetType {
  Branch,
  Commit,
  ListInsertionPoint,
  RepositoryFolder,
}

export enum DropTargetSelector {
  Branch = '.branches-list-item',
  PullRequest = '.pull-request-item',
  Commit = '.commit',
  ListInsertionPoint = '.list-insertion-point',
  RepositoryFolder = '.repository-folder-drop-target',
}

export type BranchTarget = {
  type: DropTargetType.Branch
  branchName: string
}

export type CommitTarget = {
  type: DropTargetType.Commit
}

export type ListInsertionPointTarget = {
  type: DropTargetType.ListInsertionPoint
  data: DragData
  index: RowIndexPath
}

export type RepositoryFolderTarget = {
  type: DropTargetType.RepositoryFolder
  folder: Folder
}

/**
 * This is a type is used in conjunction with the drag and drop manager to
 * pass information about a drop target.
 */
export type DropTarget =
  | BranchTarget
  | CommitTarget
  | ListInsertionPointTarget
  | RepositoryFolderTarget
