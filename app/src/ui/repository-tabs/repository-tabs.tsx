import * as React from 'react'
import classNames from 'classnames'
import { ILocalRepositoryState, Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { FoldoutType } from '../../lib/app-state'

const tabDragType = 'application/x-github-desktop-repository-tab'

interface IRepositoryTabsProps {
  readonly openRepositoryTabIDs: ReadonlyArray<number>
  readonly repositories: ReadonlyArray<Repository>
  readonly selectedRepository: Repository | null
  readonly localRepositoryStateLookup: Map<number, ILocalRepositoryState>
  readonly dispatcher: Dispatcher
}

interface IRepositoryTabsState {
  readonly dragOverTabId: number | null
}

export class RepositoryTabs extends React.Component<
  IRepositoryTabsProps,
  IRepositoryTabsState
> {
  public constructor(props: IRepositoryTabsProps) {
    super(props)
    this.state = { dragOverTabId: null }
  }

  private onTabClick = (repositoryId: number) => {
    const repo = this.props.repositories.find(r => r.id === repositoryId)
    if (repo !== undefined) {
      this.props.dispatcher.selectRepository(repo)
    }
  }

  private onCloseClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    repositoryId: number
  ) => {
    event.stopPropagation()
    this.props.dispatcher.closeRepositoryTab(repositoryId)
  }

  private onOpenAnotherRepository = () => {
    this.props.dispatcher.showFoldout({ type: FoldoutType.Repository })
  }

  private onTabContextMenu = (
    event: React.MouseEvent,
    repositoryId: number
  ) => {
    event.preventDefault()

    const items: ReadonlyArray<IMenuItem> = [
      {
        label: 'Close Tab',
        action: () => {
          this.props.dispatcher.closeRepositoryTab(repositoryId)
        },
      },
      {
        label: 'Close Other Tabs',
        action: () => {
          this.props.dispatcher.closeOtherRepositoryTabs(repositoryId)
        },
      },
      {
        label: 'Close Tabs to the Right',
        action: () => {
          this.props.dispatcher.closeRepositoryTabsToRight(repositoryId)
        },
      },
    ]

    showContextualMenu(items)
  }

  private onTabDragStart =
    (repositoryId: number) => (event: React.DragEvent) => {
      event.dataTransfer.setData(tabDragType, String(repositoryId))
      event.dataTransfer.effectAllowed = 'move'
    }

  private onTabDragOver = (repositoryId: number) => (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types)
    if (!types.includes(tabDragType)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (this.state.dragOverTabId !== repositoryId) {
      this.setState({ dragOverTabId: repositoryId })
    }
  }

  private onTabDrop =
    (targetRepositoryId: number) => (event: React.DragEvent) => {
      event.preventDefault()
      this.setState({ dragOverTabId: null })
      const raw = event.dataTransfer.getData(tabDragType)
      const dragId = parseInt(raw, 10)
      if (Number.isNaN(dragId) || dragId === targetRepositoryId) {
        return
      }

      const ids = [...this.props.openRepositoryTabIDs]
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(targetRepositoryId)
      if (from === -1 || to === -1) {
        return
      }

      const next = [...ids]
      const [removed] = next.splice(from, 1)
      next.splice(to, 0, removed)
      void this.props.dispatcher.reorderRepositoryTabs(next)
    }

  private onTabStripDragEnd = () => {
    this.setState({ dragOverTabId: null })
  }

  public render() {
    const {
      openRepositoryTabIDs,
      repositories,
      selectedRepository,
      localRepositoryStateLookup,
    } = this.props

    return (
      <div className="repository-tabs" role="presentation">
        <div
          className="repository-tabs-scroll"
          role="tablist"
          aria-label="Open repositories"
          onDragEnd={this.onTabStripDragEnd}
        >
          {openRepositoryTabIDs.map(repositoryId => {
            const repository = repositories.find(r => r.id === repositoryId)
            if (repository === undefined) {
              return null
            }

            const title =
              repository.alias != null ? repository.alias : repository.name
            const selected = selectedRepository?.id === repositoryId
            const localState = localRepositoryStateLookup.get(repositoryId)
            const ab = localState?.aheadBehind
            const hasLocalChanges =
              (localState?.changedFilesCount ?? 0) > 0 ||
              (ab != null && (ab.ahead > 0 || ab.behind > 0))

            const dropHighlight = this.state.dragOverTabId === repositoryId

            return (
              <div
                key={repositoryId}
                className={classNames('repository-tab', {
                  selected,
                  'drop-target': dropHighlight,
                })}
                role="presentation"
                onContextMenu={e => this.onTabContextMenu(e, repositoryId)}
                onDragOver={this.onTabDragOver(repositoryId)}
                onDrop={this.onTabDrop(repositoryId)}
              >
                <button
                  type="button"
                  className="repository-tab-button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  draggable
                  onDragStart={this.onTabDragStart(repositoryId)}
                  onClick={() => this.onTabClick(repositoryId)}
                >
                  {hasLocalChanges ? (
                    <span
                      className="repository-tab-dirty"
                      title="Uncommitted or unpushed changes"
                    />
                  ) : null}
                  <span className="repository-tab-label">{title}</span>
                </button>
                <button
                  type="button"
                  className="repository-tab-close"
                  aria-label={`Close ${title}`}
                  onClick={e => this.onCloseClick(e, repositoryId)}
                >
                  <Octicon symbol={octicons.x} />
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="repository-tabs-add"
          title="Open another repository…"
          aria-label="Open another repository"
          onClick={this.onOpenAnotherRepository}
        >
          <Octicon symbol={octicons.plus} />
        </button>
      </div>
    )
  }
}
