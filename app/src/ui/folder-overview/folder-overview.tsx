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
import { Repositoryish } from '../repositories-list/group-repositories'
import {
  getNewFolderMenuItem,
  getReadableTextColor,
} from '../repositories-list/folder-context-menu'
import { isFolderSelfOrDescendant } from '../repositories-list/folder-utils'
import { FolderMenu } from '../repositories-list/folder-menu'
import {
  FolderDropPosition,
  getFolderDropPosition,
  canDropRepositoryIntoFolder,
  resolveRepositoriesToMove,
} from '../repositories-list/repository-list-drag-and-drop'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
import { PopupType } from '../../models/popup'
import { Draggable } from '../lib/draggable'
import { dragAndDropManager } from '../../lib/drag-and-drop-manager'
import {
  DragType,
  DropTargetSelector,
  DropTargetType,
} from '../../models/drag-drop'
import { enableWorktreeSupport } from '../../lib/feature-flag'

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

  /** Whether the user should be asked to confirm removing a repository. */
  readonly askForConfirmationOnRemoveRepository: boolean

  /** Called when the repository should be removed. */
  readonly onRemoveRepository: (repository: Repositoryish) => void

  /** Called when the repository should be shown in Finder/Explorer/File Manager. */
  readonly onShowRepository: (repository: Repositoryish) => void

  /** Called when the repository should be opened on GitHub in the browser. */
  readonly onViewOnGitHub: (repository: Repositoryish) => void

  /** Called when the repository should be opened in the shell. */
  readonly onOpenInShell: (repository: Repositoryish) => void

  /** Called when the repository should be opened in an external editor. */
  readonly onOpenInExternalEditor: (repository: Repositoryish) => void

  /** The current external editor selected by the user. */
  readonly externalEditorLabel?: string

  /** The label for the user's preferred shell. */
  readonly shellLabel?: string
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
  /**
   * The id of the folder a repository drag is currently hovering over, used to
   * highlight it as a drop target. Separate from `dropTarget` (folder reorder).
   */
  readonly repoDropFolderID: number | null
  /**
   * The ids of repositories the user has marked with Ctrl/Cmd+click so they can
   * be dragged into a folder together. A plain click replaces this with a
   * single repository; opening a repository (double click) clears it.
   */
  readonly multiSelectedRepositoryIDs: ReadonlyArray<number>
  /** The id of the folder currently being renamed inline, if any. */
  readonly renamingFolderID: number | null
  /** The in-progress folder name while renaming inline. */
  readonly renameDraft: string
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
      repoDropFolderID: null,
      multiSelectedRepositoryIDs: [],
      renamingFolderID: null,
      renameDraft: '',
    }
  }

  private onFolderNameDoubleClick =
    (folder: Folder) => (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      this.setState({ renamingFolderID: folder.id, renameDraft: folder.name })
    }

  private onRenameDraftChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ renameDraft: event.currentTarget.value })
  }

  private onRenameKeyDown =
    (folder: Folder) => (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.commitRename(folder)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelRename()
      }
    }

  private onRenameBlur = (folder: Folder) => () => {
    this.commitRename(folder)
  }

  private commitRename(folder: Folder) {
    const name = this.state.renameDraft.trim()
    if (name.length > 0 && name !== folder.name) {
      this.props.dispatcher.renameRepositoryFolder(folder, name)
    }
    this.setState({ renamingFolderID: null, renameDraft: '' })
  }

  private cancelRename() {
    this.setState({ renamingFolderID: null, renameDraft: '' })
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

  private onFolderDragStart =
    (folder: Folder) => (event: React.DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(folder.id))
      this.setState({ dragFolderID: folder.id })
    }

  private onFolderDragOver =
    (folder: Folder) => (event: React.DragEvent<HTMLElement>) => {
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

  private onFolderDragLeave = (folder: Folder) => () => {
    if (this.state.dropTarget?.folderID === folder.id) {
      this.setState({ dropTarget: null })
    }
  }

  private onFolderDragEnd = () => {
    this.setState({ dragFolderID: null, dropTarget: null })
  }

  private onFolderDrop =
    (folder: Folder) => (event: React.DragEvent<HTMLElement>) => {
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

  private onFolderContextMenu =
    (folder: Folder) => (event: React.MouseEvent<HTMLElement>) => {
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

  private onRepositoryContextMenu =
    (repository: Repositoryish) => (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const items = generateRepositoryListContextMenu({
        repository,
        onRemoveRepository: this.props.onRemoveRepository,
        onShowRepository: this.props.onShowRepository,
        onOpenInShell: this.props.onOpenInShell,
        onOpenInExternalEditor: this.props.onOpenInExternalEditor,
        onViewOnGitHub: this.props.onViewOnGitHub,
        askForConfirmationOnRemoveRepository:
          this.props.askForConfirmationOnRemoveRepository,
        externalEditorLabel: this.props.externalEditorLabel,
        shellLabel: this.props.shellLabel,
        onChangeRepositoryAlias: this.onChangeRepositoryAlias,
        onRemoveRepositoryAlias: this.onRemoveRepositoryAlias,
        onCreateRepositoryFolder: this.onCreateRepositoryFolder,
        onUpdateRepositoryFolder: this.onUpdateRepositoryFolder,
        folders: this.props.folders,
        onCreateWorktree: enableWorktreeSupport()
          ? this.onCreateWorktree
          : undefined,
        onShowWorktrees: enableWorktreeSupport()
          ? this.onShowWorktrees
          : undefined,
      })

      showContextualMenu(items)
    }

  private onChangeRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.ChangeRepositoryAlias,
      repository,
    })
  }

  private onRemoveRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.changeRepositoryAlias(repository, null)
  }

  private onCreateRepositoryFolder = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.CreateRepositoryFolder,
      repository,
    })
  }

  private onUpdateRepositoryFolder = (
    repository: Repository,
    folderID: number | null
  ) => {
    this.props.dispatcher.updateRepositoryFolder(repository, folderID)
  }

  private onCreateWorktree = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.AddWorktree,
      repository,
    })
  }

  private onShowWorktrees = (repository: Repository) => {
    this.props.dispatcher.selectRepository(repository)
    this.props.dispatcher.showWorktreesFoldout()
  }

  private onBackgroundContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    showContextualMenu([getNewFolderMenuItem(this.props.dispatcher)])
  }

  private renderRepository = (repository: Repositoryish) => {
    const state = this.props.localRepositoryStateLookup.get(repository.id)
    const aheadBehind = state?.aheadBehind ?? null
    const changedFilesCount = state?.changedFilesCount ?? 0
    const isSelected =
      this.props.selectedRepository !== null &&
      this.props.selectedRepository.id === repository.id &&
      this.props.selectedRepository.constructor === repository.constructor

    const isMultiSelected =
      repository instanceof Repository &&
      this.state.multiSelectedRepositoryIDs.includes(repository.id)

    const icon =
      repository instanceof CloningRepository
        ? octicons.desktopDownload
        : octicons.repo

    // Indentation and the colored folder "band" are provided structurally by
    // the enclosing .folder-overview-children wrapper(s), so the row itself
    // only needs a small text inset and keeps the neutral panel background.
    const button = (
      <button
        type="button"
        key={`${repository.constructor.name}-${repository.id}`}
        className={classNames('folder-overview-repository', {
          selected: isSelected,
          'multi-selected': isMultiSelected,
        })}
        onClick={this.onRepositoryClick(repository)}
        onDoubleClick={this.onRepositoryDoubleClick(repository)}
        onContextMenu={this.onRepositoryContextMenu(repository)}
        aria-label={repository.path}
      >
        <Octicon className="repo-icon" symbol={icon} />
        <span className="repo-name">{this.getDisplayTitle(repository)}</span>
        <span className="repo-path">{repository.path}</span>
        <span className="repo-indicators">
          {changedFilesCount > 0 && (
            <span
              className="changes"
              role="img"
              aria-label="Uncommitted changes"
            >
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

    // Only real repositories can be dragged into a folder; cloning repositories
    // aren't foldered.
    if (!(repository instanceof Repository)) {
      return button
    }

    return (
      <Draggable
        key={`${repository.constructor.name}-${repository.id}`}
        isEnabled={true}
        onDragStart={this.onRepositoryDragStart(repository)}
        onRenderDragElement={this.onRenderRepositoryDragElement(repository)}
        onRemoveDragElement={this.onRemoveRepositoryDragElement}
        dropTargetSelectors={[DropTargetSelector.RepositoryFolder]}
      >
        {button}
      </Draggable>
    )
  }

  private onRepositoryClick =
    (repository: Repositoryish) =>
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // A plain click only marks the repository (so it can be dragged into a
      // folder); Ctrl/Cmd extends the selection. Opening happens on double
      // click.
      if (!(repository instanceof Repository)) {
        this.setState({ multiSelectedRepositoryIDs: [] })
        return
      }

      const additive = event.ctrlKey || event.metaKey
      this.setState(prev => {
        if (!additive) {
          return { multiSelectedRepositoryIDs: [repository.id] }
        }
        const ids = prev.multiSelectedRepositoryIDs
        return {
          multiSelectedRepositoryIDs: ids.includes(repository.id)
            ? ids.filter(id => id !== repository.id)
            : [...ids, repository.id],
        }
      })
    }

  private onRepositoryDoubleClick = (repository: Repositoryish) => () => {
    this.props.onSelectRepository(repository)
  }

  private onRepositoryDragStart = (repository: Repository) => () => {
    this.blurActiveElement()
    dragAndDropManager.setDragData({ type: DragType.Repository, repository })
  }

  private onRenderRepositoryDragElement = (repository: Repository) => () => {
    this.props.dispatcher.setDragElement({
      type: DragType.Repository,
      repository,
    })
  }

  private onRenameInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select()
  }

  private onStopPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation()
  }

  private onRemoveRepositoryDragElement = () => {
    dragAndDropManager.setDragData(null)
    dragAndDropManager.emitLeaveDropTarget()
    this.setState({ repoDropFolderID: null })
    this.props.dispatcher.clearDragElement()
  }

  private blurActiveElement() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }

  private onRepoDropTargetMouseEnter = (folder: Folder) => () => {
    this.updateRepositoryFolderDropTarget(folder)
  }

  private onRepoDropTargetMouseMove = (folder: Folder) => () => {
    this.updateRepositoryFolderDropTarget(folder)
  }

  private onRepoDropTargetMouseLeave = (folder: Folder) => () => {
    if (this.state.repoDropFolderID === folder.id) {
      this.setState({ repoDropFolderID: null })
    }
  }

  private onRepoDropTargetMouseUp = (folder: Folder) => () => {
    this.dropRepositoriesIntoFolder(folder)
  }

  private updateRepositoryFolderDropTarget(folder: Folder) {
    const dragData = dragAndDropManager.dragData
    if (
      dragData === null ||
      dragData.type !== DragType.Repository ||
      !canDropRepositoryIntoFolder(dragData.repository, folder)
    ) {
      return
    }

    dragAndDropManager.emitEnterDropTarget({
      type: DropTargetType.RepositoryFolder,
      folder,
    })
    if (this.state.repoDropFolderID !== folder.id) {
      this.setState({ repoDropFolderID: folder.id })
    }
  }

  private dropRepositoriesIntoFolder(folder: Folder) {
    const dragData = dragAndDropManager.dragData
    if (dragData === null || dragData.type !== DragType.Repository) {
      return
    }

    // If the dragged repository is part of the multi-selection, move every
    // selected repository into the folder; otherwise just the dragged one.
    const toMove = resolveRepositoriesToMove(
      this.props.repositories,
      this.state.multiSelectedRepositoryIDs,
      dragData.repository
    )

    for (const repository of toMove) {
      if (canDropRepositoryIntoFolder(repository, folder)) {
        this.props.dispatcher.updateRepositoryFolder(repository, folder.id)
      }
    }

    this.setState({ repoDropFolderID: null, multiSelectedRepositoryIDs: [] })
  }

  /**
   * Recursively renders a folder and everything it contains. A folder's element
   * literally wraps its subfolders, so the hierarchy is structural and the
   * colored "band" is a single left border on the children wrapper (which
   * therefore spans the whole folder, subfolders included). Nested colored
   * folders add their own band inside the parent's — butted against it with no
   * gap.
   */
  private renderFolder = (
    folder: Folder,
    byParent: ReadonlyMap<number | null, ReadonlyArray<Folder>>
  ): JSX.Element | null => {
    const repos = this.getFolderRepositories(folder)
    const childFolders = byParent.get(folder.id) ?? []
    const collapsed =
      !this.isFiltering && this.props.collapsedFolderIDs.includes(folder.id)

    const renderedChildren = collapsed
      ? []
      : childFolders
          .map(child => this.renderFolder(child, byParent))
          .filter((node): node is JSX.Element => node !== null)

    // While filtering, hide a folder that neither matches by name, contains a
    // matching repository, nor has any visible descendant folder.
    if (
      this.isFiltering &&
      !this.folderMatchesFilter(folder) &&
      repos.length === 0 &&
      renderedChildren.length === 0
    ) {
      return null
    }

    const dropTarget =
      this.state.dropTarget?.folderID === folder.id
        ? this.state.dropTarget
        : null

    const headerStyle: React.CSSProperties = {}
    if (folder.color !== null) {
      headerStyle.backgroundColor = folder.color
      headerStyle.color = getReadableTextColor(folder.color)
    }

    const childrenStyle =
      folder.color !== null
        ? ({ '--folder-band-color': folder.color } as React.CSSProperties)
        : undefined

    const isRenaming = this.state.renamingFolderID === folder.id

    return (
      <div className="folder-overview-section" key={`folder-${folder.id}`}>
        <div
          className={classNames(
            'folder-overview-folder-header',
            'repository-folder-drop-target',
            {
              'has-color': folder.color !== null,
              'repository-drop-target':
                this.state.repoDropFolderID === folder.id,
              'folder-drop-before': dropTarget?.position === 'before',
              'folder-drop-after': dropTarget?.position === 'after',
              'folder-drop-into': dropTarget?.position === 'into',
            }
          )}
          style={headerStyle}
          role="presentation"
          draggable={!isRenaming}
          onDragStart={this.onFolderDragStart(folder)}
          onDragOver={this.onFolderDragOver(folder)}
          onDragLeave={this.onFolderDragLeave(folder)}
          onDragEnd={this.onFolderDragEnd}
          onDrop={this.onFolderDrop(folder)}
          onContextMenu={this.onFolderContextMenu(folder)}
          onMouseEnter={this.onRepoDropTargetMouseEnter(folder)}
          onMouseMove={this.onRepoDropTargetMouseMove(folder)}
          onMouseLeave={this.onRepoDropTargetMouseLeave(folder)}
          onMouseUp={this.onRepoDropTargetMouseUp(folder)}
        >
          <button
            type="button"
            className="folder-overview-disclosure"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
            onClick={this.onToggleCollapsed(folder)}
          >
            <Octicon
              symbol={collapsed ? octicons.chevronRight : octicons.chevronDown}
            />
          </button>
          <Octicon symbol={octicons.fileDirectory} />
          {isRenaming ? (
            <input
              className="folder-name-input"
              type="text"
              value={this.state.renameDraft}
              aria-label={`Rename ${folder.name}`}
              autoFocus={true}
              onChange={this.onRenameDraftChange}
              onKeyDown={this.onRenameKeyDown(folder)}
              onBlur={this.onRenameBlur(folder)}
              onFocus={this.onRenameInputFocus}
              onClick={this.onStopPropagation}
              onDoubleClick={this.onStopPropagation}
              onMouseDown={this.onStopPropagation}
            />
          ) : (
            <span
              className="folder-name"
              onDoubleClick={this.onFolderNameDoubleClick(folder)}
            >
              {folder.name}
            </span>
          )}
          <span className="folder-count">
            {repos.length === 1 ? '1 repo' : `${repos.length} repos`}
          </span>
        </div>
        {!collapsed && (repos.length > 0 || renderedChildren.length > 0) && (
          <div
            className={classNames('folder-overview-children', {
              'has-color': folder.color !== null,
            })}
            style={childrenStyle}
          >
            {repos.map(r => this.renderRepository(r))}
            {renderedChildren}
          </div>
        )}
      </div>
    )
  }

  private onToggleCollapsed =
    (folder: Folder) => (event: React.MouseEvent<HTMLButtonElement>) => {
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
        <div className="folder-overview-children">
          {repos.map(r => this.renderRepository(r))}
        </div>
      </div>
    )
  }

  public render() {
    const { isFiltering } = this

    // Group folders by parent (sorted by sortOrder) so we can render the tree
    // recursively — each folder element wraps its own subfolders.
    const byParent = new Map<number | null, Folder[]>()
    for (const folder of this.props.folders) {
      const parent = folder.parentFolderID ?? null
      const list = byParent.get(parent) ?? []
      list.push(folder)
      byParent.set(parent, list)
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder)
    }

    const renderedFolders = (byParent.get(null) ?? [])
      .map(folder => this.renderFolder(folder, byParent))
      .filter((node): node is JSX.Element => node !== null)

    const hasVisibleNoFolderRepo = this.props.repositories.some(
      r =>
        (!(r instanceof Repository) || r.folderID === null) &&
        this.repositoryMatchesFilter(r)
    )
    const hasResults = renderedFolders.length > 0 || hasVisibleNoFolderRepo

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
          {renderedFolders}
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
