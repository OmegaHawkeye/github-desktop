import * as React from 'react'

import { Repository, ILocalRepositoryState } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { Folder } from '../../models/folder'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import classNames from 'classnames'
import { Dispatcher } from '../dispatcher'
import { TextBox } from '../lib/text-box'
import { showContextualMenu } from '../../lib/menu-item'
import {
  Repositoryish,
  getFoldersInTreeOrder,
  folderDepth,
} from '../repositories-list/group-repositories'
import {
  getMoveRepositoryToFolderMenuItem,
  getNewFolderMenuItem,
  getReadableTextColor,
} from '../repositories-list/folder-context-menu'
import {
  isFolderSelfOrDescendant,
  isFolderHiddenByCollapsedAncestor,
} from '../repositories-list/folder-utils'
import { FolderMenu } from '../repositories-list/folder-menu'
import {
  FolderDropPosition,
  getFolderDropPosition,
} from '../repositories-list/repository-list-drag-and-drop'
import { PopupType } from '../../models/popup'

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
  /** The text entered by the user to filter folders and repositories. */
  readonly filterText: string
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
    this.state = {
      dragFolderID: null,
      dropTarget: null,
      folderMenu: null,
      filterText: '',
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onSearchCleared = () => {
    this.setState({ filterText: '' })
  }

  /**
   * Whether the user is currently filtering. When filtering, folders are
   * expanded regardless of their collapsed state and only matching content is
   * shown.
   */
  private get isFiltering(): boolean {
    return this.state.filterText.trim().length > 0
  }

  private repositoryMatchesFilter = (repository: Repositoryish): boolean => {
    const query = this.state.filterText.trim().toLowerCase()
    if (query.length === 0) {
      return true
    }
    return (
      this.getDisplayTitle(repository).toLowerCase().includes(query) ||
      repository.path.toLowerCase().includes(query)
    )
  }

  private folderMatchesFilter(folder: Folder): boolean {
    const query = this.state.filterText.trim().toLowerCase()
    return query.length === 0 || folder.name.toLowerCase().includes(query)
  }

  /**
   * The repositories to display for a given folder, taking the active filter
   * into account. When the folder's own name matches the filter, all of its
   * repositories are shown; otherwise only the repositories that match.
   */
  private getFolderRepositories(folder: Folder): ReadonlyArray<Repositoryish> {
    const repos = this.props.repositories.filter(
      r => r instanceof Repository && r.folderID === folder.id
    )

    if (!this.isFiltering || this.folderMatchesFilter(folder)) {
      return repos
    }

    return repos.filter(this.repositoryMatchesFilter)
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
    const byID = new Map(this.props.folders.map(f => [f.id, f]))
    if (isFolderSelfOrDescendant(folder.id, dragFolderID, byID)) {
      return
    }

    const dragged = this.props.folders.find(f => f.id === dragFolderID)
    if (dragged !== undefined) {
      this.props.dispatcher
        .moveFolderRelativeTo(dragged, folder, position)
        .catch(() => undefined)
    }
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
      getMoveRepositoryToFolderMenuItem(repository, this.props.folders, {
        onUpdateFolder: folderID =>
          this.props.dispatcher.updateRepositoryFolder(repository, folderID),
        onCreateFolder: () =>
          this.props.dispatcher.showPopup({
            type: PopupType.CreateRepositoryFolder,
            repository,
          }),
      }),
    ])
  }

  private onBackgroundContextMenu = (event: React.MouseEvent<HTMLElement>) => {
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

    // Repositories inside a colored folder keep the neutral panel background
    // (matching the folder header and the sidebar) and are tied to their
    // folder by a left edge in the folder's color, passed to CSS as a custom
    // property so the built-in hover/selection backgrounds keep working.
    const hasColor = folderColor !== null
    const style = {
      paddingLeft: 24 + depth * 16,
      ...(hasColor ? { '--folder-accent-color': folderColor } : {}),
    } as React.CSSProperties

    return (
      <button
        type="button"
        key={`${repository.constructor.name}-${repository.id}`}
        className={classNames('folder-overview-repository', {
          selected: isSelected,
          'has-color': hasColor,
        })}
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
    const byID = new Map(this.props.folders.map(f => [f.id, f]))
    const depth = folderDepth(folder, byID)
    const repos = this.getFolderRepositories(folder)

    // While filtering, hide folders that neither match by name nor contain any
    // matching repositories.
    if (
      this.isFiltering &&
      !this.folderMatchesFilter(folder) &&
      repos.length === 0
    ) {
      return null
    }

    const dropTarget =
      this.state.dropTarget?.folderID === folder.id
        ? this.state.dropTarget
        : null

    const headerStyle: React.CSSProperties = { paddingLeft: 8 + depth * 16 }
    if (folder.color !== null) {
      headerStyle.backgroundColor = folder.color
      headerStyle.color = getReadableTextColor(folder.color)
    }

    const collapsed =
      !this.isFiltering && this.props.collapsedFolderIDs.includes(folder.id)

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

  private renderNoFolderSection() {
    const repos = this.props.repositories
      .filter(r => !(r instanceof Repository) || r.folderID === null)
      .filter(this.repositoryMatchesFilter)

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
    const byID = new Map(this.props.folders.map(f => [f.id, f]))
    const collapsedIDSet = new Set(this.props.collapsedFolderIDs)
    const { isFiltering } = this
    const orderedFolders = getFoldersInTreeOrder(this.props.folders).filter(
      f =>
        isFiltering || !isFolderHiddenByCollapsedAncestor(f, byID, collapsedIDSet)
    )

    // Determine whether any content will be rendered so we can show an
    // appropriate empty/no-results message.
    const hasVisibleFolder = orderedFolders.some(
      f =>
        !isFiltering ||
        this.folderMatchesFilter(f) ||
        this.getFolderRepositories(f).length > 0
    )
    const hasVisibleNoFolderRepo = this.props.repositories.some(
      r =>
        (!(r instanceof Repository) || r.folderID === null) &&
        this.repositoryMatchesFilter(r)
    )
    const hasResults = hasVisibleFolder || hasVisibleNoFolderRepo

    return (
      <div className="folder-overview">
        <div className="folder-overview-header">
          <div className="title">
            <Octicon symbol={octicons.fileDirectory} />
            Folder overview
          </div>
          <TextBox
            className="folder-overview-search"
            type="search"
            placeholder="Search folders and repositories"
            ariaLabel="Search folders and repositories"
            value={this.state.filterText}
            prefixedIcon={octicons.search}
            displayClearButton={true}
            onValueChanged={this.onFilterTextChanged}
            onSearchCleared={this.onSearchCleared}
          />
        </div>
        <div
          className="folder-overview-content"
          onContextMenu={this.onBackgroundContextMenu}
        >
          {orderedFolders.map(this.renderFolderSection)}
          {this.renderNoFolderSection()}
          {!hasResults && (
            <div className="folder-overview-empty">
              {isFiltering
                ? 'No folders or repositories match your search.'
                : "You haven't created any folders yet. Right-click a " +
                  'repository (or the empty space) in the repository list to ' +
                  'create one.'}
            </div>
          )}
        </div>
        {this.renderFolderMenu()}
      </div>
    )
  }
}
