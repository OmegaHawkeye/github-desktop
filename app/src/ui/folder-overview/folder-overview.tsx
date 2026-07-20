import * as React from 'react'

import { Repository, ILocalRepositoryState } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { Folder } from '../../models/folder'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import classNames from 'classnames'
import { Dispatcher } from '../dispatcher'
import { showContextualMenu } from '../../lib/menu-item'
import {
  Repositoryish,
  getFoldersInTreeOrder,
} from '../repositories-list/group-repositories'
import {
  getMoveRepositoryToFolderMenuItem,
  getNewFolderMenuItem,
  getReadableTextColor,
  hexToRgba,
} from '../repositories-list/folder-context-menu'
import { FolderMenu } from '../repositories-list/folder-menu'
import {
  FolderDropPosition,
  getFolderDropPosition,
} from '../repositories-list/repository-list-drag-and-drop'

interface IFolderOverviewProps {
  readonly dispatcher: Dispatcher
  readonly repositories: ReadonlyArray<Repositoryish>
  readonly folders: ReadonlyArray<Folder>
  readonly collapsedFolderIDs: ReadonlyArray<number>
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >
  readonly selectedRepository: Repositoryish | null

  /** Invoked when the user picks a repository (should also close the overview). */
  readonly onSelectRepository: (repository: Repositoryish) => void
}

interface IFolderOverviewState {
  /** The id of the folder currently being dragged, if any. */
  readonly dragFolderID: number | null
  /** The active drop target while dragging a folder. */
  readonly dropTarget: {
    readonly folderID: number
    readonly position: FolderDropPosition
  } | null
  /** The open custom folder context menu, if any. */
  readonly folderMenu: {
    readonly folderID: number
    readonly x: number
    readonly y: number
  } | null
}

/**
 * A full main-area view that lists every folder and the repositories it
 * contains, giving a birds-eye overview of how repositories are organized.
 */
export class FolderOverview extends React.Component<
  IFolderOverviewProps,
  IFolderOverviewState
> {
  public constructor(props: IFolderOverviewProps) {
    super(props)
    this.state = { dragFolderID: null, dropTarget: null, folderMenu: null }
  }

  private isSelfOrDescendant(candidateID: number, ancestorID: number): boolean {
    const byID = new Map(this.props.folders.map(f => [f.id, f]))
    let id: number | null = candidateID
    const seen = new Set<number>()
    while (id !== null && !seen.has(id)) {
      if (id === ancestorID) {
        return true
      }
      seen.add(id)
      id = byID.get(id)?.parentFolderID ?? null
    }
    return false
  }

  private onFolderDragStart = (
    folder: Folder,
    event: React.DragEvent<HTMLElement>
  ) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(folder.id))
    this.setState({ dragFolderID: folder.id })
  }

  private onFolderDragOver = (
    folder: Folder,
    event: React.DragEvent<HTMLElement>
  ) => {
    const { dragFolderID } = this.state
    if (dragFolderID === null || dragFolderID === folder.id) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const bounds = event.currentTarget.getBoundingClientRect()
    const position = getFolderDropPosition(bounds, event.clientY)
    const { dropTarget } = this.state
    if (
      dropTarget === null ||
      dropTarget.folderID !== folder.id ||
      dropTarget.position !== position
    ) {
      this.setState({ dropTarget: { folderID: folder.id, position } })
    }
  }

  private onFolderDragLeave = (folder: Folder) => {
    if (this.state.dropTarget?.folderID === folder.id) {
      this.setState({ dropTarget: null })
    }
  }

  private onFolderDragEnd = () => {
    this.setState({ dragFolderID: null, dropTarget: null })
  }

  private onFolderDrop = (
    folder: Folder,
    event: React.DragEvent<HTMLElement>
  ) => {
    event.preventDefault()
    const { dragFolderID, dropTarget } = this.state
    const position = dropTarget?.position ?? 'into'
    this.setState({ dragFolderID: null, dropTarget: null })

    if (dragFolderID === null || dragFolderID === folder.id) {
      return
    }

    // Prevent dropping a folder into itself or one of its own descendants.
    if (this.isSelfOrDescendant(folder.id, dragFolderID)) {
      return
    }

    const dragged = this.props.folders.find(f => f.id === dragFolderID)
    if (dragged !== undefined) {
      this.props.dispatcher
        .moveFolderRelativeTo(dragged, folder, position)
        .catch(() => undefined)
    }
  }

  private folderDepth(folder: Folder): number {
    const byID = new Map(this.props.folders.map(f => [f.id, f]))
    let depth = 0
    let parentID = folder.parentFolderID
    const seen = new Set<number>([folder.id])
    while (parentID !== null && !seen.has(parentID)) {
      seen.add(parentID)
      depth++
      parentID = byID.get(parentID)?.parentFolderID ?? null
    }
    return depth
  }

  private getDisplayTitle(repository: Repositoryish): string {
    return repository instanceof Repository && repository.alias !== null
      ? repository.alias
      : repository.name
  }

  private onFolderContextMenu = (
    folder: Folder,
    event: React.MouseEvent<HTMLElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
    this.setState({
      folderMenu: { folderID: folder.id, x: event.clientX, y: event.clientY },
    })
  }

  private closeFolderMenu = () => {
    this.setState({ folderMenu: null })
  }

  private renderFolderMenu() {
    const { folderMenu } = this.state
    if (folderMenu === null) {
      return null
    }

    const folder = this.props.folders.find(f => f.id === folderMenu.folderID)
    if (folder === undefined) {
      return null
    }

    return (
      <FolderMenu
        folder={folder}
        folders={this.props.folders}
        dispatcher={this.props.dispatcher}
        clientX={folderMenu.x}
        clientY={folderMenu.y}
        onClose={this.closeFolderMenu}
      />
    )
  }

  private onRepositoryContextMenu = (
    repository: Repositoryish,
    event: React.MouseEvent<HTMLElement>
  ) => {
    if (!(repository instanceof Repository)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    showContextualMenu([
      getMoveRepositoryToFolderMenuItem(
        repository,
        this.props.folders,
        this.props.dispatcher
      ),
    ])
  }

  private onBackgroundContextMenu = (
    event: React.MouseEvent<HTMLElement>
  ) => {
    event.preventDefault()
    showContextualMenu([getNewFolderMenuItem(this.props.dispatcher)])
  }

  private renderRepository = (
    repository: Repositoryish,
    depth: number,
    folderColor: string | null = null
  ) => {
    const state = this.props.localRepositoryStateLookup.get(repository.id)
    const aheadBehind = state?.aheadBehind ?? null
    const changedFilesCount = state?.changedFilesCount ?? 0
    const isSelected =
      this.props.selectedRepository !== null &&
      this.props.selectedRepository.id === repository.id &&
      this.props.selectedRepository.constructor === repository.constructor

    const icon =
      repository instanceof CloningRepository
        ? octicons.desktopDownload
        : octicons.repo

    const style: React.CSSProperties = { paddingLeft: 24 + depth * 16 }
    if (folderColor !== null && !isSelected) {
      style.backgroundColor = hexToRgba(folderColor, 0.28)
    }

    return (
      <button
        type="button"
        key={`${repository.constructor.name}-${repository.id}`}
        className={
          'folder-overview-repository' + (isSelected ? ' selected' : '')
        }
        style={style}
        onClick={() => this.props.onSelectRepository(repository)}
        onContextMenu={e => this.onRepositoryContextMenu(repository, e)}
        title={repository.path}
      >
        <Octicon className="repo-icon" symbol={icon} />
        <span className="repo-name">{this.getDisplayTitle(repository)}</span>
        <span className="repo-path">{repository.path}</span>
        <span className="repo-indicators">
          {changedFilesCount > 0 && (
            <span className="changes" title="Uncommitted changes">
              <Octicon symbol={octicons.dotFill} />
            </span>
          )}
          {aheadBehind !== null && aheadBehind.ahead > 0 && (
            <span className="ahead">
              {aheadBehind.ahead}
              <Octicon symbol={octicons.arrowUp} />
            </span>
          )}
          {aheadBehind !== null && aheadBehind.behind > 0 && (
            <span className="behind">
              {aheadBehind.behind}
              <Octicon symbol={octicons.arrowDown} />
            </span>
          )}
        </span>
      </button>
    )
  }

  private renderFolderSection = (folder: Folder) => {
    const depth = this.folderDepth(folder)
    const repos = this.props.repositories.filter(
      r => r instanceof Repository && r.folderID === folder.id
    )

    const dropTarget =
      this.state.dropTarget?.folderID === folder.id
        ? this.state.dropTarget
        : null

    const headerStyle: React.CSSProperties = { paddingLeft: 8 + depth * 16 }
    if (folder.color !== null) {
      headerStyle.backgroundColor = folder.color
      headerStyle.color = getReadableTextColor(folder.color)
    }

    const collapsed = this.props.collapsedFolderIDs.includes(folder.id)

    return (
      <div className="folder-overview-section" key={`folder-${folder.id}`}>
        <div
          className={classNames('folder-overview-folder-header', {
            'has-color': folder.color !== null,
            'folder-drop-before': dropTarget?.position === 'before',
            'folder-drop-after': dropTarget?.position === 'after',
            'folder-drop-into': dropTarget?.position === 'into',
          })}
          style={headerStyle}
          draggable={true}
          onDragStart={e => this.onFolderDragStart(folder, e)}
          onDragOver={e => this.onFolderDragOver(folder, e)}
          onDragLeave={() => this.onFolderDragLeave(folder)}
          onDragEnd={this.onFolderDragEnd}
          onDrop={e => this.onFolderDrop(folder, e)}
          onContextMenu={e => this.onFolderContextMenu(folder, e)}
        >
          <button
            type="button"
            className="folder-overview-disclosure"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
            onClick={e => this.onToggleCollapsed(folder, e)}
          >
            <Octicon
              symbol={collapsed ? octicons.chevronRight : octicons.chevronDown}
            />
          </button>
          <Octicon symbol={octicons.fileDirectory} />
          <span className="folder-name">{folder.name}</span>
          <span className="folder-count">
            {repos.length === 1 ? '1 repo' : `${repos.length} repos`}
          </span>
        </div>
        {!collapsed &&
          repos.map(r => this.renderRepository(r, depth, folder.color))}
      </div>
    )
  }

  private onToggleCollapsed = (
    folder: Folder,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation()
    this.props.dispatcher.toggleCollapsedRepositoryFolder(folder.id)
  }

  private isHiddenByCollapsedAncestor(folder: Folder): boolean {
    const byID = new Map(this.props.folders.map(f => [f.id, f]))
    let pid = folder.parentFolderID
    const seen = new Set<number>()
    while (pid !== null && !seen.has(pid)) {
      if (this.props.collapsedFolderIDs.includes(pid)) {
        return true
      }
      seen.add(pid)
      pid = byID.get(pid)?.parentFolderID ?? null
    }
    return false
  }

  private renderNoFolderSection() {
    const repos = this.props.repositories.filter(
      r => !(r instanceof Repository) || r.folderID === null
    )

    if (repos.length === 0) {
      return null
    }

    return (
      <div className="folder-overview-section" key="folder-none">
        <div className="folder-overview-folder-header">
          <Octicon symbol={octicons.fileDirectory} />
          <span className="folder-name">No folder</span>
          <span className="folder-count">
            {repos.length === 1 ? '1 repo' : `${repos.length} repos`}
          </span>
        </div>
        {repos.map(r => this.renderRepository(r, 0))}
      </div>
    )
  }

  public render() {
    const orderedFolders = getFoldersInTreeOrder(this.props.folders).filter(
      f => !this.isHiddenByCollapsedAncestor(f)
    )

    return (
      <div className="folder-overview">
        <div className="folder-overview-header">
          <div className="title">
            <Octicon symbol={octicons.fileDirectory} />
            Folder overview
          </div>
        </div>
        <div
          className="folder-overview-content"
          onContextMenu={this.onBackgroundContextMenu}
        >
          {orderedFolders.map(this.renderFolderSection)}
          {this.renderNoFolderSection()}
          {orderedFolders.length === 0 && (
            <div className="folder-overview-empty">
              You haven't created any folders yet. Right-click a repository (or
              the empty space) in the repository list to create one.
            </div>
          )}
        </div>
        {this.renderFolderMenu()}
      </div>
    )
  }
}
