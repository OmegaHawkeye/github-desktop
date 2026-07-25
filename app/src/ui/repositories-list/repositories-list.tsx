import * as React from 'react'

import { RepositoryListItem } from './repository-list-item'
import {
  IRepositoryListItem,
  Repositoryish,
  RepositoryListGroup,
  getGroupKey,
} from './group-repositories'
import { IMatches } from '../../lib/fuzzy-find'
import { TextBox } from '../lib/text-box'
import {
  buildRepositoriesTree,
  IRepositoryTreeFolder,
  IRepositoryTreeSection,
  IRepositoryTreeItem,
} from './build-repositories-tree'
import { RepositoriesTree, RepositoryTreeNode } from './repositories-tree'
import { ILocalRepositoryState, Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { showContextualMenu } from '../../lib/menu-item'
import { IMenuItem } from '../../lib/menu-item'
import { PopupType } from '../../models/popup'
import { encodePathAsUrl } from '../../lib/path'
import { TooltippedContent } from '../lib/tooltipped-content'
import memoizeOne from 'memoize-one'
import classNames from 'classnames'
import { KeyboardShortcut } from '../keyboard-shortcut/keyboard-shortcut'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
import { enableWorktreeSupport } from '../../lib/feature-flag'
import { assertNever } from '../../lib/fatal-error'
import { Folder } from '../../models/folder'
import { Draggable } from '../lib/draggable'
import { dragAndDropManager } from '../../lib/drag-and-drop-manager'
import {
  DragType,
  DropTargetSelector,
  DropTargetType,
} from '../../models/drag-drop'
import {
  canDropRepositoryIntoFolder,
  FolderDropPosition,
  getFolderDropPosition,
  resolveRepositoriesToMove,
} from './repository-list-drag-and-drop'
import {
  getNewFolderMenuItem,
  getReadableTextColor,
} from './folder-context-menu'
import { FolderMenu } from './folder-menu'

const BlankSlateImage = encodePathAsUrl(__dirname, 'static/empty-no-repo.svg')

interface IRepositoriesListProps {
  readonly selectedRepository: Repositoryish | null
  readonly repositories: ReadonlyArray<Repositoryish>
  readonly folders: ReadonlyArray<Folder>
  readonly collapsedFolderIDs: ReadonlyArray<number>
  readonly recentRepositories: ReadonlyArray<number>

  /** A cache of the latest repository state values, keyed by the repository id */
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >

  /** Called when a repository has been selected. */
  readonly onSelectionChanged: (repository: Repositoryish) => void

  /** Whether the user has enabled the setting to confirm removing a repository from the app */
  readonly askForConfirmationOnRemoveRepository: boolean

  /** Called when the repository should be removed. */
  readonly onRemoveRepository: (repository: Repositoryish) => void

  /** Called when the repository should be shown in Finder/Explorer/File Manager. */
  readonly onShowRepository: (repository: Repositoryish) => void

  /** Called when the repository should be opened on GitHub in the default web browser. */
  readonly onViewOnGitHub: (repository: Repositoryish) => void

  /** Called when the repository should be shown in the shell. */
  readonly onOpenInShell: (repository: Repositoryish) => void

  /** Called when the repository should be opened in an external editor */
  readonly onOpenInExternalEditor: (repository: Repositoryish) => void

  /** The current external editor selected by the user */
  readonly externalEditorLabel?: string

  /** The label for the user's preferred shell. */
  readonly shellLabel?: string

  /** The callback to fire when the filter text has changed */
  readonly onFilterTextChanged: (text: string) => void

  /** The text entered by the user to filter their repository list */
  readonly filterText: string

  readonly dispatcher: Dispatcher
}

interface IRepositoriesListState {
  readonly newRepositoryMenuExpanded: boolean
  /** The open custom folder context menu, if any. */
  readonly folderMenu: {
    readonly folderID: number
    readonly x: number
    readonly y: number
  } | null
  readonly activeFolderDropTarget: IActiveFolderDropTarget | null
  /**
   * The ids of repositories the user has marked with Ctrl/Cmd+click so they can
   * be dragged into a folder together. A plain click replaces this with a
   * single repository; opening a repository (double click / Enter) clears it.
   */
  readonly multiSelectedRepositoryIDs: ReadonlyArray<number>
}

interface IActiveFolderDropTarget {
  readonly folderID: number
  readonly kind: 'repository' | 'folder'
  readonly position?: FolderDropPosition
}

/** The list of user-added repositories. */
export class RepositoriesList extends React.Component<
  IRepositoriesListProps,
  IRepositoriesListState
> {
  private getGroupContextMenuHandler = memoizeOne(
    (group: RepositoryListGroup) => (event: React.MouseEvent<HTMLDivElement>) =>
      this.onGroupContextMenu(group, event)
  )
  private getRepositoryDragStartHandler = memoizeOne(
    (repository: Repository) => () => this.onRepositoryDragStart(repository)
  )
  private getRepositoryDragElementRenderer = memoizeOne(
    (repository: Repository) => () =>
      this.onRenderRepositoryDragElement(repository)
  )
  private getFolderDragStartHandler = memoizeOne(
    (folder: Folder) => () => this.onFolderDragStart(folder)
  )
  private getFolderDragElementRenderer = memoizeOne(
    (folder: Folder) => () => this.onRenderFolderDragElement(folder)
  )

  public constructor(props: IRepositoriesListProps) {
    super(props)

    this.state = {
      newRepositoryMenuExpanded: false,
      activeFolderDropTarget: null,
      folderMenu: null,
      multiSelectedRepositoryIDs: [],
    }
  }

  private renderItem = (item: IRepositoryListItem, matches: IMatches) => {
    const repository = item.repository
    const listItem = (
      <RepositoryListItem
        key={repository.id}
        repository={repository}
        needsDisambiguation={item.needsDisambiguation}
        matches={matches}
        aheadBehind={item.aheadBehind}
        changedFilesCount={item.changedFilesCount}
        isMultiSelected={this.state.multiSelectedRepositoryIDs.includes(
          repository.id
        )}
      />
    )

    // A plain click marks the repo (multi-select); double click opens it. These
    // used to be provided by SectionFilterList's row handling.
    const rowMouseProps = {
      onClick: (e: React.MouseEvent<HTMLDivElement>) =>
        this.onRepoRowClick(item, e),
      onDoubleClick: () => this.openRepository(item),
      onContextMenu: (e: React.MouseEvent<HTMLDivElement>) =>
        this.onItemContextMenu(item, e),
    }

    if (!(repository instanceof Repository)) {
      return (
        <div className="repository-row-content" {...rowMouseProps}>
          {listItem}
        </div>
      )
    }

    // Repositories inside a colored folder keep the neutral panel background;
    // their folder membership is shown by the color band on the enclosing tree
    // wrapper. The folder-section drop target lets a drag land on the row.
    const content =
      item.group.kind === 'folder' ? (
        <div
          role="presentation"
          className="repository-folder-drop-target repository-folder-section-drop-target"
          onMouseEnter={this.onFolderSectionDropTargetMouseEnter(
            item.group.folder
          )}
          onMouseMove={this.onFolderSectionDropTargetMouseMove(
            item.group.folder
          )}
          onMouseLeave={this.onFolderSectionDropTargetMouseLeave(
            item.group.folder
          )}
          onMouseUp={this.onFolderSectionDropTargetMouseUp(item.group.folder)}
          {...rowMouseProps}
        >
          {listItem}
        </div>
      ) : (
        <div className="repository-row-content" {...rowMouseProps}>
          {listItem}
        </div>
      )

    return (
      <Draggable
        isEnabled={true}
        onDragStart={this.getRepositoryDragStartHandler(repository)}
        onRenderDragElement={this.getRepositoryDragElementRenderer(repository)}
        onRemoveDragElement={this.onRemoveDragElement}
        dropTargetSelectors={[DropTargetSelector.RepositoryFolder]}
      >
        {content}
      </Draggable>
    )
  }

  private onRepoRowClick = (
    item: IRepositoryListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    this.toggleMultiSelection(item.repository, event.ctrlKey || event.metaKey)
  }

  private getGroupLabel(group: RepositoryListGroup) {
    const { kind } = group
    if (kind === 'enterprise') {
      return group.host
    } else if (kind === 'folder') {
      return group.folder.name
    } else if (kind === 'other') {
      return 'Other'
    } else if (kind === 'dotcom') {
      return group.owner.login
    } else if (kind === 'recent') {
      return 'Recent'
    } else {
      assertNever(kind, `Unknown repository group kind ${kind}`)
    }
  }

  private renderGroupHeader = (group: RepositoryListGroup) => {
    const label = this.getGroupLabel(group)
    const content = this.renderGroupHeaderContent(group, label)

    if (group.kind !== 'folder') {
      return (
        <div onContextMenu={this.getGroupContextMenuHandler(group)}>
          {content}
        </div>
      )
    }

    return (
      <div
        className="repository-folder-header-wrapper"
        onContextMenu={this.getGroupContextMenuHandler(group)}
      >
        <Draggable
          isEnabled={true}
          onDragStart={this.getFolderDragStartHandler(group.folder)}
          onRenderDragElement={this.getFolderDragElementRenderer(group.folder)}
          onRemoveDragElement={this.onRemoveDragElement}
          dropTargetSelectors={[DropTargetSelector.RepositoryFolder]}
        >
          {content}
        </Draggable>
      </div>
    )
  }

  private renderGroupHeaderContent(group: RepositoryListGroup, label: string) {
    const activeDropTarget =
      group.kind === 'folder' &&
      this.state.activeFolderDropTarget?.folderID === group.folder.id
        ? this.state.activeFolderDropTarget
        : null

    if (group.kind !== 'folder') {
      return (
        <div className="filter-list-group-header">
          <TooltippedContent
            key={getGroupKey(group)}
            className="repository-folder-drop-target-content"
            tooltip={label}
            onlyWhenOverflowed={true}
            tagName="div"
          >
            {label}
          </TooltippedContent>
        </div>
      )
    }

    const isCollapsed =
      this.props.filterText.length === 0 &&
      this.props.collapsedFolderIDs.includes(group.folder.id)

    const color = group.folder.color
    // Indentation and the nested color band come from the enclosing tree
    // wrappers; the header only carries its own color as the name background.
    const headerStyle: React.CSSProperties = {}
    if (color !== null) {
      headerStyle.backgroundColor = color
      headerStyle.color = getReadableTextColor(color)
    }
    return (
      <div
        role="presentation"
        className={classNames(
          'filter-list-group-header',
          'repository-folder-drop-target',
          'repository-folder-header',
          {
            'has-color': color !== null,
            collapsed: isCollapsed,
            'active-drop-target': activeDropTarget !== null,
            'repository-drop-target': activeDropTarget?.kind === 'repository',
            'folder-drop-before': activeDropTarget?.position === 'before',
            'folder-drop-after': activeDropTarget?.position === 'after',
            'folder-drop-into': activeDropTarget?.position === 'into',
          }
        )}
        style={headerStyle}
        onMouseEnter={this.onFolderDropTargetMouseEnter(group.folder)}
        onMouseMove={this.onFolderDropTargetMouseMove(group.folder)}
        onMouseLeave={this.onFolderDropTargetMouseLeave(group.folder)}
        onMouseUp={this.onFolderDropTargetMouseUp(group.folder)}
      >
        <button
          type="button"
          className="repository-folder-disclosure-button"
          onMouseDown={this.onFolderDisclosureMouseDown}
          onClick={this.onToggleFolderCollapsed(group.folder)}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          <Octicon
            symbol={isCollapsed ? octicons.chevronRight : octicons.chevronDown}
          />
        </button>
        <TooltippedContent
          key={getGroupKey(group)}
          className="repository-folder-drop-target-content"
          tooltip={label}
          onlyWhenOverflowed={true}
          tagName="div"
        >
          {label}
        </TooltippedContent>
        <span
          className="repository-folder-drop-target-spacer"
          aria-hidden="true"
        />
      </div>
    )
  }

  private onRepositoryDragStart(repository: Repository) {
    this.blurActiveElement()
    dragAndDropManager.setDragData({
      type: DragType.Repository,
      repository,
    })
  }

  private onFolderDragStart(folder: Folder) {
    this.blurActiveElement()
    dragAndDropManager.setDragData({
      type: DragType.RepositoryFolder,
      folder,
    })
  }

  private onRenderRepositoryDragElement(repository: Repository) {
    this.props.dispatcher.setDragElement({
      type: DragType.Repository,
      repository,
    })
  }

  private onRenderFolderDragElement(folder: Folder) {
    this.props.dispatcher.setDragElement({
      type: DragType.RepositoryFolder,
      folder,
    })
  }

  private onRemoveDragElement = () => {
    dragAndDropManager.setDragData(null)
    dragAndDropManager.emitLeaveDropTarget()
    this.setState({ activeFolderDropTarget: null })
    this.props.dispatcher.clearDragElement()
  }

  private blurActiveElement() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }

  private onFolderDisclosureMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
  }

  private onToggleFolderCollapsed =
    (folder: Folder) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      this.props.dispatcher.toggleCollapsedRepositoryFolder(folder.id)
    }

  private onFolderSectionDropTargetMouseEnter =
    (folder: Folder) => (_event: React.MouseEvent<HTMLDivElement>) => {
      this.updateRepositoryFolderDropTarget(folder)
    }

  private onFolderSectionDropTargetMouseMove =
    (folder: Folder) => (_event: React.MouseEvent<HTMLDivElement>) => {
      this.updateRepositoryFolderDropTarget(folder)
    }

  private onFolderSectionDropTargetMouseLeave =
    (folder: Folder) => (_event: React.MouseEvent<HTMLDivElement>) => {
      this.clearActiveFolderDropTarget(folder)
    }

  private onFolderSectionDropTargetMouseUp =
    (folder: Folder) => (_event: React.MouseEvent<HTMLDivElement>) => {
      this.dropRepositoryIntoFolder(folder)
    }

  private onFolderDropTargetMouseEnter =
    (folder: Folder) => (event: React.MouseEvent<HTMLDivElement>) => {
      this.updateActiveFolderDropTarget(folder, event)
    }

  private onFolderDropTargetMouseMove =
    (folder: Folder) => (event: React.MouseEvent<HTMLDivElement>) => {
      this.updateActiveFolderDropTarget(folder, event)
    }

  private onFolderDropTargetMouseLeave =
    (folder: Folder) => (_event: React.MouseEvent<HTMLDivElement>) => {
      this.clearActiveFolderDropTarget(folder)
    }

  private onFolderDropTargetMouseUp =
    (folder: Folder) => (event: React.MouseEvent<HTMLDivElement>) => {
      const dragData = dragAndDropManager.dragData
      if (dragData === null) {
        return
      }

      const position = getFolderDropPosition(
        event.currentTarget.getBoundingClientRect(),
        event.clientY
      )

      if (dragData.type === DragType.Repository) {
        this.dropRepositoryIntoFolder(folder)
        return
      }

      if (dragData.type !== DragType.RepositoryFolder) {
        return
      }

      if (dragData.folder.id === folder.id) {
        return
      }

      void this.props.dispatcher
        .moveFolderRelativeTo(dragData.folder, folder, position)
        .catch(err => {
          log.error('Failed to move repository folder', err)
          return this.props.dispatcher.presentError(err)
        })
    }

  private updateActiveFolderDropTarget(
    folder: Folder,
    event: React.MouseEvent<HTMLDivElement>
  ) {
    const dragData = dragAndDropManager.dragData
    if (dragData === null) {
      return
    }

    if (dragData.type === DragType.Repository) {
      this.updateRepositoryFolderDropTarget(folder)
      return
    }

    if (
      dragData.type !== DragType.RepositoryFolder ||
      dragData.folder.id === folder.id
    ) {
      return
    }

    const position = getFolderDropPosition(
      event.currentTarget.getBoundingClientRect(),
      event.clientY
    )

    dragAndDropManager.emitEnterDropTarget({
      type: DropTargetType.RepositoryFolder,
      folder,
    })
    this.setState({
      activeFolderDropTarget: {
        folderID: folder.id,
        kind: 'folder',
        position,
      },
    })
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
    this.setState({
      activeFolderDropTarget: {
        folderID: folder.id,
        kind: 'repository',
      },
    })
  }

  private dropRepositoryIntoFolder(folder: Folder) {
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

    this.setState({ multiSelectedRepositoryIDs: [] })
  }

  private clearActiveFolderDropTarget(folder: Folder) {
    if (this.state.activeFolderDropTarget?.folderID !== folder.id) {
      return
    }

    this.setState({ activeFolderDropTarget: null })
    dragAndDropManager.emitLeaveDropTarget()
  }

  private openRepository(item: IRepositoryListItem) {
    const hasIndicator =
      item.changedFilesCount > 0 ||
      (item.aheadBehind !== null
        ? item.aheadBehind.ahead > 0 || item.aheadBehind.behind > 0
        : false)
    this.props.dispatcher.recordRepoClicked(hasIndicator)
    this.setState({ multiSelectedRepositoryIDs: [] })
    this.props.onSelectionChanged(item.repository)
  }

  /**
   * Toggle a repository in/out of the multi-selection. When not additive the
   * selection is replaced with just this repository. Only real repositories
   * (not cloning ones, which can't be foldered) participate.
   */
  private toggleMultiSelection(repository: Repositoryish, additive: boolean) {
    if (!(repository instanceof Repository)) {
      this.setState({ multiSelectedRepositoryIDs: [] })
      return
    }

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

  private onItemContextMenu = (
    item: IRepositoryListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()

    const items = generateRepositoryListContextMenu({
      onRemoveRepository: this.props.onRemoveRepository,
      onShowRepository: this.props.onShowRepository,
      onOpenInShell: this.props.onOpenInShell,
      onOpenInExternalEditor: this.props.onOpenInExternalEditor,
      askForConfirmationOnRemoveRepository:
        this.props.askForConfirmationOnRemoveRepository,
      externalEditorLabel: this.props.externalEditorLabel,
      onChangeRepositoryAlias: this.onChangeRepositoryAlias,
      onRemoveRepositoryAlias: this.onRemoveRepositoryAlias,
      onCreateRepositoryFolder: this.onCreateRepositoryFolder,
      onUpdateRepositoryFolder: this.onUpdateRepositoryFolder,
      onViewOnGitHub: this.props.onViewOnGitHub,
      folders: this.props.folders,
      onCreateWorktree: enableWorktreeSupport()
        ? this.onCreateWorktree
        : undefined,
      onShowWorktrees: enableWorktreeSupport()
        ? this.onShowWorktrees
        : undefined,
      repository: item.repository,
      shellLabel: this.props.shellLabel,
    })

    showContextualMenu(items)
  }

  public render() {
    const tree = buildRepositoriesTree(
      this.props.repositories,
      this.props.folders,
      this.props.localRepositoryStateLookup,
      this.props.recentRepositories,
      this.props.filterText
    )

    const nodes = this.buildTreeNodes(tree)

    return (
      <div
        className="repository-list"
        onContextMenu={this.onListBackgroundContextMenu}
      >
        <Row className="filter-field-row">
          <TextBox
            type="search"
            className="repository-filter-field"
            placeholder="Filter"
            ariaLabel="Filter repositories"
            value={this.props.filterText}
            onValueChanged={this.props.onFilterTextChanged}
          />
          {this.renderPostFilter()}
        </Row>
        {nodes.length === 0 ? (
          this.renderNoItems()
        ) : (
          <div className="repository-list-scroller">
            <RepositoriesTree
              nodes={nodes}
              onActivateRepository={this.onActivateRepository}
              onToggleFolder={this.onToggleFolderKeyboard}
              onToggleMultiSelect={this.onToggleMultiSelectKeyboard}
            />
          </div>
        )}
        {this.renderFolderMenu()}
      </div>
    )
  }

  private buildTreeNodes(tree: {
    recent: IRepositoryTreeSection | null
    folders: ReadonlyArray<IRepositoryTreeFolder>
    otherSections: ReadonlyArray<IRepositoryTreeSection>
  }): ReadonlyArray<RepositoryTreeNode> {
    const nodes = new Array<RepositoryTreeNode>()

    if (tree.recent !== null) {
      nodes.push(this.buildSectionNode(tree.recent))
    }
    for (const folder of tree.folders) {
      nodes.push(this.buildFolderNode(folder))
    }
    for (const section of tree.otherSections) {
      nodes.push(this.buildSectionNode(section))
    }

    return nodes
  }

  private buildSectionNode(
    section: IRepositoryTreeSection
  ): RepositoryTreeNode {
    return {
      kind: 'section',
      key: `section-${getGroupKey(section.group)}`,
      header: this.renderGroupHeader(section.group),
      children: section.items.map(ti => this.buildRepoNode(ti)),
    }
  }

  private buildFolderNode(node: IRepositoryTreeFolder): RepositoryTreeNode {
    const { folder } = node
    const group: RepositoryListGroup = {
      kind: 'folder',
      folder,
      depth: node.depth,
    }
    const collapsed =
      this.props.filterText.length === 0 &&
      this.props.collapsedFolderIDs.includes(folder.id)

    return {
      kind: 'folder',
      key: `folder-${folder.id}`,
      folder,
      color: folder.color,
      collapsed,
      header: this.renderGroupHeader(group),
      children: [
        ...node.items.map(ti => this.buildRepoNode(ti)),
        ...node.children.map(child => this.buildFolderNode(child)),
      ],
    }
  }

  private buildRepoNode(ti: IRepositoryTreeItem): RepositoryTreeNode {
    const { item } = ti
    const repository = item.repository
    const selected =
      this.props.selectedRepository !== null &&
      this.props.selectedRepository.id === repository.id &&
      this.props.selectedRepository.constructor === repository.constructor

    return {
      kind: 'repo',
      key: `repo-${repository.constructor.name}-${repository.id}`,
      repository,
      selected,
      multiSelected: this.state.multiSelectedRepositoryIDs.includes(
        repository.id
      ),
      row: this.renderItem(item, ti.matches),
    }
  }

  private onActivateRepository = (repository: Repositoryish) => {
    this.setState({ multiSelectedRepositoryIDs: [] })
    this.props.onSelectionChanged(repository)
  }

  private onToggleFolderKeyboard = (folder: Folder) => {
    this.props.dispatcher.toggleCollapsedRepositoryFolder(folder.id)
  }

  private onToggleMultiSelectKeyboard = (repository: Repositoryish) => {
    this.toggleMultiSelection(repository, true)
  }

  private onGroupContextMenu = (
    group: RepositoryListGroup,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    if (group.kind !== 'folder') {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    this.setState({
      folderMenu: {
        folderID: group.folder.id,
        x: event.clientX,
        y: event.clientY,
      },
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

  /**
   * Context menu for the empty space of the repository list, allowing the user
   * to create a new top-level folder without needing an existing repository.
   */
  private onListBackgroundContextMenu = (
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    // Let the more specific handlers (repository rows and folder headers) take
    // precedence when the click landed on one of them.
    if (
      event.target instanceof Element &&
      event.target.closest('.list-item, .filter-list-group-header') !== null
    ) {
      return
    }

    event.preventDefault()

    showContextualMenu([getNewFolderMenuItem(this.props.dispatcher)])
  }

  private renderPostFilter = () => {
    return (
      <Button
        className="new-repository-button"
        onClick={this.onNewRepositoryButtonClick}
        ariaExpanded={this.state.newRepositoryMenuExpanded}
        onKeyDown={this.onNewRepositoryButtonKeyDown}
      >
        Add
        <Octicon symbol={octicons.triangleDown} />
      </Button>
    )
  }

  private onNewRepositoryButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'ArrowDown') {
      this.onNewRepositoryButtonClick()
    }
  }

  private renderNoItems = () => {
    return (
      <div className="no-items no-results-found">
        <img src={BlankSlateImage} className="blankslate-image" alt="" />
        <div className="title">Sorry, I can't find that repository</div>

        <div className="protip">
          ProTip! Press{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut darwinKeys={['⌘', 'O']} keys={['Ctrl', 'O']} />
          </div>{' '}
          to quickly add a local repository, and{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut
              darwinKeys={['⇧', '⌘', 'O']}
              keys={['Ctrl', 'Shift', 'O']}
            />
          </div>{' '}
          to clone from anywhere within the app
        </div>
      </div>
    )
  }

  private onNewRepositoryButtonClick = () => {
    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Clone Repository…' : 'Clone repository…',
        action: this.onCloneRepository,
      },
      {
        label: __DARWIN__ ? 'Create New Repository…' : 'Create new repository…',
        action: this.onCreateNewRepository,
      },
      {
        label: __DARWIN__
          ? 'Add Existing Repository…'
          : 'Add existing repository…',
        action: this.onAddExistingRepository,
      },
    ]

    this.setState({ newRepositoryMenuExpanded: true })
    showContextualMenu(items).then(() => {
      this.setState({ newRepositoryMenuExpanded: false })
    })
  }

  private onCloneRepository = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL: null,
    })
  }

  private onAddExistingRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.AddRepository })
  }

  private onCreateNewRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.CreateRepository })
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

  private onCreateWorktree = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.AddWorktree,
      repository,
    })
  }

  private onUpdateRepositoryFolder = (
    repository: Repository,
    folderID: number | null
  ) => {
    this.props.dispatcher.updateRepositoryFolder(repository, folderID)
  }

  private onShowWorktrees = (repository: Repository) => {
    this.props.dispatcher.selectRepository(repository)
    this.props.dispatcher.showWorktreesFoldout()
  }
}
