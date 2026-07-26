import * as React from 'react'
import classNames from 'classnames'
import { Folder } from '../../models/folder'
import { Repositoryish } from './group-repositories'

/**
 * A node in the repositories sidebar tree. Content (header / row markup) is
 * rendered by RepositoriesList and passed in, so all of its existing handlers
 * (drag/drop, context menus, rename, selection) are reused unchanged. This
 * component owns only the nested structure, the continuous color band, roving
 * focus, keyboard navigation and ARIA.
 */
export type RepositoryTreeNode =
  | {
      readonly kind: 'folder'
      readonly key: string
      readonly folder: Folder
      /** The folder's own color, or null. Drives the children wrapper's band. */
      readonly color: string | null
      readonly collapsed: boolean
      readonly header: JSX.Element
      readonly children: ReadonlyArray<RepositoryTreeNode>
    }
  | {
      readonly kind: 'repo'
      readonly key: string
      readonly repository: Repositoryish
      readonly selected: boolean
      readonly multiSelected: boolean
      readonly row: JSX.Element
    }
  | {
      // A flat, non-folder section (recent / dotcom / enterprise / other).
      readonly kind: 'section'
      readonly key: string
      readonly header: JSX.Element | null
      readonly children: ReadonlyArray<RepositoryTreeNode>
    }

interface IRepositoriesTreeProps {
  readonly nodes: ReadonlyArray<RepositoryTreeNode>

  /** Open/activate a repository (Enter / keyboard). */
  readonly onActivateRepository: (repository: Repositoryish) => void

  /** Toggle a folder's collapsed state (←/→ / Enter on a folder). */
  readonly onToggleFolder: (folder: Folder) => void

  /** Toggle a repository in the multi-selection (Space). */
  readonly onToggleMultiSelect: (repository: Repositoryish) => void
}

interface IRepositoriesTreeState {
  /** The key of the row that currently owns the roving tabstop. */
  readonly focusedKey: string | null
}

export class RepositoriesTree extends React.Component<
  IRepositoriesTreeProps,
  IRepositoriesTreeState
> {
  private readonly rowRefs = new Map<string, HTMLDivElement>()

  /** Focusable rows (folders + repos) in visible top-to-bottom order. */
  private focusableKeys = new Array<string>()

  public constructor(props: IRepositoriesTreeProps) {
    super(props)
    this.state = { focusedKey: null }
  }

  private setRowRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el === null) {
      this.rowRefs.delete(key)
    } else {
      this.rowRefs.set(key, el)
    }
  }

  /** Depth-first list of focusable row keys, skipping collapsed subtrees. */
  private collectFocusableKeys(
    nodes: ReadonlyArray<RepositoryTreeNode>,
    out: Array<string>
  ) {
    for (const node of nodes) {
      if (node.kind === 'repo') {
        out.push(node.key)
      } else if (node.kind === 'folder') {
        out.push(node.key)
        if (!node.collapsed) {
          this.collectFocusableKeys(node.children, out)
        }
      } else {
        this.collectFocusableKeys(node.children, out)
      }
    }
  }

  private findNode(
    nodes: ReadonlyArray<RepositoryTreeNode>,
    key: string
  ): RepositoryTreeNode | null {
    for (const node of nodes) {
      if (node.key === key) {
        return node
      }
      if (node.kind !== 'repo') {
        const found = this.findNode(node.children, key)
        if (found !== null) {
          return found
        }
      }
    }
    return null
  }

  private focusRow(key: string) {
    this.setState({ focusedKey: key })
    const el = this.rowRefs.get(key)
    if (el !== undefined) {
      el.focus()
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  private moveFocus(currentKey: string | null, delta: number) {
    const keys = this.focusableKeys
    if (keys.length === 0) {
      return
    }
    const currentIndex = currentKey === null ? -1 : keys.indexOf(currentKey)
    let nextIndex = currentIndex + delta
    nextIndex = Math.max(0, Math.min(keys.length - 1, nextIndex))
    this.focusRow(keys[nextIndex])
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Ignore keys that originate from an inline editor (e.g. folder rename).
    if (event.target instanceof HTMLInputElement) {
      return
    }

    const focusedKey = this.state.focusedKey
    const node =
      focusedKey !== null ? this.findNode(this.props.nodes, focusedKey) : null

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        this.moveFocus(focusedKey, 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        this.moveFocus(focusedKey, -1)
        break
      case 'Home':
        event.preventDefault()
        if (this.focusableKeys.length > 0) {
          this.focusRow(this.focusableKeys[0])
        }
        break
      case 'End':
        event.preventDefault()
        if (this.focusableKeys.length > 0) {
          this.focusRow(this.focusableKeys[this.focusableKeys.length - 1])
        }
        break
      case 'ArrowRight':
        if (node?.kind === 'folder' && node.collapsed) {
          event.preventDefault()
          this.props.onToggleFolder(node.folder)
        }
        break
      case 'ArrowLeft':
        if (node?.kind === 'folder' && !node.collapsed) {
          event.preventDefault()
          this.props.onToggleFolder(node.folder)
        }
        break
      case 'Enter':
        if (node?.kind === 'repo') {
          event.preventDefault()
          this.props.onActivateRepository(node.repository)
        } else if (node?.kind === 'folder') {
          event.preventDefault()
          this.props.onToggleFolder(node.folder)
        }
        break
      case ' ':
        if (node?.kind === 'repo') {
          event.preventDefault()
          this.props.onToggleMultiSelect(node.repository)
        }
        break
    }
  }

  private onRowFocus = (key: string) => () => {
    if (this.state.focusedKey !== key) {
      this.setState({ focusedKey: key })
    }
  }

  private tabIndexFor(key: string): number {
    // Roving tabindex: the focused row (or the first focusable row when nothing
    // is focused yet) is the single tab stop for the whole tree.
    const active =
      this.state.focusedKey ??
      (this.focusableKeys.length > 0 ? this.focusableKeys[0] : null)
    return key === active ? 0 : -1
  }

  private renderNode(node: RepositoryTreeNode): JSX.Element {
    if (node.kind === 'repo') {
      return (
        <div
          key={node.key}
          role="treeitem"
          aria-selected={node.selected}
          tabIndex={this.tabIndexFor(node.key)}
          ref={this.setRowRef(node.key)}
          onFocus={this.onRowFocus(node.key)}
          className={classNames('repositories-tree-repo', {
            selected: node.selected,
            'multi-selected': node.multiSelected,
          })}
        >
          {node.row}
        </div>
      )
    }

    if (node.kind === 'folder') {
      const hasChildren = node.children.length > 0
      return (
        <div
          key={node.key}
          role="treeitem"
          aria-expanded={!node.collapsed}
          aria-selected={false}
          tabIndex={this.tabIndexFor(node.key)}
          ref={this.setRowRef(node.key)}
          onFocus={this.onRowFocus(node.key)}
          className="repositories-tree-folder"
        >
          {node.header}
          {!node.collapsed && hasChildren && (
            <div
              role="group"
              className={classNames('repositories-tree-children', {
                'has-color': node.color !== null,
              })}
              style={
                node.color !== null
                  ? ({
                      '--folder-band-color': node.color,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              {node.children.map(child => this.renderNode(child))}
            </div>
          )}
        </div>
      )
    }

    // Non-folder section: a (non-focusable) header followed by its rows.
    return (
      <div
        key={node.key}
        role="presentation"
        className="repositories-tree-section"
      >
        {node.header}
        {node.children.map(child => this.renderNode(child))}
      </div>
    )
  }

  public render() {
    // Recompute the focusable order for keyboard navigation on every render so
    // it always reflects the current filter/collapse state.
    this.focusableKeys = []
    this.collectFocusableKeys(this.props.nodes, this.focusableKeys)

    return (
      <div
        className="repositories-tree"
        role="tree"
        aria-label="Repositories"
        tabIndex={-1}
        onKeyDown={this.onKeyDown}
      >
        {this.props.nodes.map(node => this.renderNode(node))}
      </div>
    )
  }
}
