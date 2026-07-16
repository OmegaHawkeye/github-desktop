import * as React from 'react'

import { commitGrammar, RepositoryListItem } from './repository-list-item'
import {
  groupRepositories,
  IRepositoryListItem,
  Repositoryish,
  RepositoryListGroup,
  getGroupKey,
} from './group-repositories'
import { IFilterListGroup } from '../lib/filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { ILocalRepositoryState, Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
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
import { SectionFilterList } from '../lib/section-filter-list'
import { assertNever } from '../../lib/fatal-error'
import { IAheadBehind } from '../../models/branch'
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
} from './repository-list-drag-and-drop'

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
  readonly selectedItem: IRepositoryListItem | null
  readonly activeFolderDropTarget: IActiveFolderDropTarget | null
}

interface IActiveFolderDropTarget {
  readonly folderID: number
  readonly kind: 'repository' | 'folder'
  readonly position?: FolderDropPosition
}

const RowHeight = 29

/**
 * Iterate over all groups until a list item is found that matches
 * the id of the provided repository.
 */
function findMatchingListItem(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  selectedRepository: Repositoryish | null
) {
  if (selectedRepository !== null) {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.repository.id === selectedRepository.id) {
          return item
        }
      }
    }
  }

  return null
}

function isFolderHiddenByCollapsedAncestor(
  folder: Folder,
  folders: ReadonlyArray<Folder>,
  collapsedFolderIDSet: ReadonlySet<number>
): boolean {
  let pid: number | null = folder.parentFolderID
  const byId = new Map(folders.map(f => [f.id, f]))
  while (pid !== null) {
    if (collapsedFolderIDSet.has(pid)) {
      return true
    }
    const parent = byId.get(pid)
    pid = parent?.parentFolderID ?? null
  }
  return false
}

function getVisibleRepositoryGroups(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  collapsedFolderIDs: ReadonlyArray<number>,
  folders: ReadonlyArray<Folder>
) {
  const collapsedFolderIDSet = new Set(collapsedFolderIDs)
  return groups
    .filter(
      group =>
        group.identifier.kind !== 'folder' ||
        !isFolderHiddenByCollapsedAncestor(
          group.identifier.folder,
          folders,
          collapsedFolderIDSet
        )
    )
    .map(group => {
      if (group.identifier.kind !== 'folder') {
        return group
      }
      return collapsedFolderIDSet.has(group.identifier.folder.id)
        ? { ...group, items: [] }
        : group
    })
}

/** The list of user-added repositories. */
export class RepositoriesList extends React.Component<
  IRepositoriesListProps,
  IRepositoriesListState
> {
  /**
   * A memoized function for grouping repositories for display
   * in the FilterList. The group will not be recomputed as long
   * as the provided list of repositories is equal to the last
   * time the method was called (reference equality).
   */
  private getRepositoryGroups = memoizeOne(
    (
      repositories: ReadonlyArray<Repositoryish> | null,
      folders: ReadonlyArray<Folder>,
      localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
      recentRepositories: ReadonlyArray<number>,
      collapsedFolderIDs: ReadonlyArray<number>,
      collapseFolders: boolean
    ) =>
      repositories === null
        ? []
        : getVisibleRepositoryGroups(
            groupRepositories(
              repositories,
              folders,
              localRepositoryStateLookup,
              recentRepositories
            ),
            collapseFolders ? collapsedFolderIDs : [],
            folders
          )
  )

  /**
   * A memoized function for finding the selected list item based
   * on an IAPIRepository instance. The selected item will not be
   * recomputed as long as the provided list of repositories and
   * the selected data object is equal to the last time the method
   * was called (reference equality).
   *
   * See findMatchingListItem for more details.
   */
  private getSelectedListItem = memoizeOne(findMatchingListItem)
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
      selectedItem: null,
      activeFolderDropTarget: null,
    }
  }

  private renderItem = (item: IRepositoryListItem, matches: IMatches) => {
    const repository = item.repository
    let content = (
      <RepositoryListItem
        key={repository.id}
        repository={repository}
        needsDisambiguation={item.needsDisambiguation}
        matches={matches}
        aheadBehind={item.aheadBehind}
        changedFilesCount={item.changedFilesCount}
      />
    )

    if (!(repository instanceof Repository)) {
      return content
    }

    if (item.group.kind === 'folder') {
      content = (
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
        >
          {content}
        </div>
      )
    }

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

  private getAheadBehindTooltip = (aheadBehind: IAheadBehind | null) => {
    if (aheadBehind === null) {
      return null
    }

    const { ahead, behind } = aheadBehind

    if (behind === 0 && ahead === 0) {
      return null
    }

    return (
      'The currently checked out branch is' +
      (behind ? ` ${commitGrammar(behind)} behind ` : '') +
      (behind && ahead ? 'and' : '') +
      (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
      'its tracked branch.'
    )
  }

  private renderRowFocusTooltip = (
    item: IRepositoryListItem
  ): JSX.Element | string | null => {
    const { repository, aheadBehind, changedFilesCount } = item
    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const alias = repository instanceof Repository ? repository.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repository.name
    const aheadBehindTooltip = this.getAheadBehindTooltip(aheadBehind)
    const hasChanges = changedFilesCount > 0
    const uncommittedChangesTooltip = hasChanges
      ? `There are uncommitted changes in this repository.`
      : null

    const ahead = aheadBehind?.ahead ?? 0
    const behind = aheadBehind?.behind ?? 0

    return (
      <div className="repository-list-item-tooltip list-item-tooltip">
        <div>
          <div className="label">Full Name: </div>
          {realName}
          {alias && <> ({alias})</>}
        </div>
        <div>
          <div className="label">Path: </div>
          {repository.path}
        </div>
        {aheadBehindTooltip && (
          <div>
            <div className="label">
              <div className="ahead-behind">
                {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
                {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
              </div>
            </div>
            {aheadBehindTooltip}
          </div>
        )}
        {uncommittedChangesTooltip && (
          <div>
            <div className="label">
              <span className="change-indicator-wrapper">
                <Octicon symbol={octicons.dotFill} />
              </span>
            </div>
            {uncommittedChangesTooltip}
          </div>
        )}
      </div>
    )
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

    const depth = group.depth
    return (
      <div
        role="presentation"
        className={classNames(
          'filter-list-group-header',
          'repository-folder-drop-target',
          'repository-folder-header',
          {
            'active-drop-target': activeDropTarget !== null,
            'repository-drop-target': activeDropTarget?.kind === 'repository',
            'folder-drop-before': activeDropTarget?.position === 'before',
            'folder-drop-after': activeDropTarget?.position === 'after',
            'folder-drop-into': activeDropTarget?.position === 'into',
          }
        )}
        style={{ paddingLeft: depth * 12 }}
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
    (folder: Folder) => (event: React.MouseEvent<HTMLDivElement>) => {
      this.updateRepositoryFolderDropTarget(folder, 'into')
    }

  private onFolderSectionDropTargetMouseMove =
    (folder: Folder) => (event: React.MouseEvent<HTMLDivElement>) => {
      this.updateRepositoryFolderDropTarget(folder, 'into')
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
    if (
      dragData === null ||
      dragData.type !== DragType.Repository ||
      !canDropRepositoryIntoFolder(dragData.repository, folder)
    ) {
      return
    }

    this.props.dispatcher.updateRepositoryFolder(dragData.repository, folder.id)
  }

  private clearActiveFolderDropTarget(folder: Folder) {
    if (this.state.activeFolderDropTarget?.folderID !== folder.id) {
      return
    }

    this.setState({ activeFolderDropTarget: null })
    dragAndDropManager.emitLeaveDropTarget()
  }

  private onItemClick = (item: IRepositoryListItem) => {
    const hasIndicator =
      item.changedFilesCount > 0 ||
      (item.aheadBehind !== null
        ? item.aheadBehind.ahead > 0 || item.aheadBehind.behind > 0
        : false)
    this.props.dispatcher.recordRepoClicked(hasIndicator)
    this.props.onSelectionChanged(item.repository)
  }

  private onItemContextMenu = (
    item: IRepositoryListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()

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
      repository: item.repository,
      shellLabel: this.props.shellLabel,
    })

    showContextualMenu(items)
  }

  private getItemAriaLabel = (item: IRepositoryListItem) => item.repository.name
  private getGroupAriaLabelGetter =
    (
      groups: ReadonlyArray<
        IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
      >
    ) =>
    (group: number) =>
      this.getGroupLabel(groups[group].identifier)

  public render() {
    const groups = this.getRepositoryGroups(
      this.props.repositories,
      this.props.folders,
      this.props.localRepositoryStateLookup,
      this.props.recentRepositories,
      this.props.collapsedFolderIDs,
      this.props.filterText.length === 0
    )

    // So there's two types of selection at play here. There's the repository
    // selection for the whole app and then there's the keyboard selection in
    // the list itself. If the user has selected a repository using keyboard
    // navigation we want to honor that selection. If the user hasn't selected a
    // repository yet we'll select the repository currently selected in the app.
    const selectedItem =
      this.state.selectedItem ??
      this.getSelectedListItem(groups, this.props.selectedRepository)

    return (
      <div className="repository-list">
        <SectionFilterList<IRepositoryListItem, RepositoryListGroup>
          rowHeight={RowHeight}
          selectedItem={selectedItem}
          filterText={this.props.filterText}
          onFilterTextChanged={this.props.onFilterTextChanged}
          renderItem={this.renderItem}
          renderRowFocusTooltip={this.renderRowFocusTooltip}
          renderGroupHeader={this.renderGroupHeader}
          onItemClick={this.onItemClick}
          renderPostFilter={this.renderPostFilter}
          renderNoItems={this.renderNoItems}
          groups={groups}
          invalidationProps={{
            repositories: this.props.repositories,
            filterText: this.props.filterText,
            collapsedFolderIDs: this.props.collapsedFolderIDs,
          }}
          onItemContextMenu={this.onItemContextMenu}
          getGroupAriaLabel={this.getGroupAriaLabelGetter(groups)}
          getItemAriaLabel={this.getItemAriaLabel}
          onSelectionChanged={this.onSelectionChanged}
          shouldKeepGroupWhenEmpty={
            this.props.filterText.length === 0
              ? this.shouldKeepEmptyGroupVisible
              : undefined
          }
        />
      </div>
    )
  }

  private shouldKeepEmptyGroupVisible = (group: RepositoryListGroup) =>
    group.kind === 'folder'

  private onSelectionChanged = (selectedItem: IRepositoryListItem | null) => {
    this.setState({ selectedItem })
  }

  private onGroupContextMenu = (
    group: RepositoryListGroup,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    if (group.kind !== 'folder') {
      return
    }

    event.preventDefault()

    showContextualMenu([
      {
        label: __DARWIN__ ? 'Rename Folder…' : 'Rename folder…',
        action: () =>
          this.props.dispatcher.showPopup({
            type: PopupType.RenameRepositoryFolder,
            folder: group.folder,
          }),
      },
      {
        label: __DARWIN__ ? 'Delete Folder…' : 'Delete folder…',
        action: () =>
          this.props.dispatcher.showPopup({
            type: PopupType.DeleteRepositoryFolder,
            folder: group.folder,
          }),
      },
    ])
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

  private onUpdateRepositoryFolder = (
    repository: Repository,
    folderID: number | null
  ) => {
    this.props.dispatcher.updateRepositoryFolder(repository, folderID)
  }
}
