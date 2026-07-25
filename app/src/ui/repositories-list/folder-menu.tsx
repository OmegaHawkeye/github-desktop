import * as React from 'react'

import { Folder } from '../../models/folder'
import { Dispatcher } from '../dispatcher'
import { PopupType } from '../../models/popup'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { FolderColors, getFolderSiblings } from './folder-context-menu'

interface IFolderMenuProps {
  readonly folder: Folder
  readonly folders: ReadonlyArray<Folder>
  readonly dispatcher: Dispatcher
  /** Viewport coordinates where the menu should open (the right-click point). */
  readonly clientX: number
  readonly clientY: number
  readonly onClose: () => void
}

interface IFolderMenuState {
  readonly top: number
  readonly left: number
}

const DefaultCustomColor = '#0969da'

/**
 * A custom (HTML) context menu for a repository folder. Unlike the native OS
 * context menu it can render an inline color picker (swatches + a custom color
 * input + a remove button) directly in the menu.
 */
export class FolderMenu extends React.Component<
  IFolderMenuProps,
  IFolderMenuState
> {
  private readonly menuRef = React.createRef<HTMLDivElement>()

  public constructor(props: IFolderMenuProps) {
    super(props)
    this.state = { top: props.clientY, left: props.clientX }
  }

  public componentDidMount() {
    document.addEventListener('mousedown', this.onDocumentMouseDown, true)
    document.addEventListener('keydown', this.onDocumentKeyDown, true)
    window.addEventListener('resize', this.props.onClose)
    window.addEventListener('blur', this.props.onClose)

    // Clamp the menu within the viewport now that we can measure it.
    const el = this.menuRef.current
    if (el !== null) {
      const rect = el.getBoundingClientRect()
      const margin = 8
      let { top, left } = this.state
      if (left + rect.width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - rect.width - margin)
      }
      if (top + rect.height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - rect.height - margin)
      }
      if (top !== this.state.top || left !== this.state.left) {
        this.setState({ top, left })
      }
      el.focus()
    }
  }

  public componentWillUnmount() {
    document.removeEventListener('mousedown', this.onDocumentMouseDown, true)
    document.removeEventListener('keydown', this.onDocumentKeyDown, true)
    window.removeEventListener('resize', this.props.onClose)
    window.removeEventListener('blur', this.props.onClose)
  }

  private onDocumentMouseDown = (event: MouseEvent) => {
    if (
      event.target instanceof Node &&
      this.menuRef.current?.contains(event.target)
    ) {
      return
    }
    this.props.onClose()
  }

  private onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.props.onClose()
    }
  }

  private run(action: () => void) {
    action()
    this.props.onClose()
  }

  private setColor(color: string | null) {
    this.props.dispatcher.setRepositoryFolderColor(this.props.folder, color)
  }

  private onSwatchClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const value = event.currentTarget.dataset.color
    if (value === undefined) {
      return
    }
    const current = this.props.folder.color?.toLowerCase() ?? null
    // Toggle: clicking the already-selected color clears it.
    this.setColor(current === value.toLowerCase() ? null : value)
    this.props.onClose()
  }

  private onRemoveColor = () => this.setColor(null)

  private onCustomColorChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setColor(event.currentTarget.value)
  }

  private onNewSubfolder = () =>
    this.run(() =>
      this.props.dispatcher.showPopup({
        type: PopupType.CreateRepositoryFolder,
        parentFolderID: this.props.folder.id,
      })
    )

  private onNewFolderBefore = () =>
    this.run(() =>
      this.props.dispatcher.showPopup({
        type: PopupType.CreateRepositoryFolder,
        parentFolderID: this.props.folder.parentFolderID,
        positionRelativeTo: { folder: this.props.folder, position: 'before' },
      })
    )

  private onNewFolderAfter = () =>
    this.run(() =>
      this.props.dispatcher.showPopup({
        type: PopupType.CreateRepositoryFolder,
        parentFolderID: this.props.folder.parentFolderID,
        positionRelativeTo: { folder: this.props.folder, position: 'after' },
      })
    )

  private onCloneRepository = () =>
    this.run(() =>
      this.props.dispatcher.showPopup({
        type: PopupType.CloneRepository,
        initialURL: null,
        initialFolderID: this.props.folder.id,
      })
    )

  private onAddRepository = () =>
    this.run(() =>
      this.props.dispatcher.showPopup({
        type: PopupType.AddRepository,
        folderID: this.props.folder.id,
      })
    )

  private onMoveUp = () => {
    const { previous } = getFolderSiblings(
      this.props.folder,
      this.props.folders
    )
    if (previous !== null) {
      this.run(() =>
        this.props.dispatcher.moveFolderRelativeTo(
          this.props.folder,
          previous,
          'before'
        )
      )
    }
  }

  private onMoveDown = () => {
    const { next } = getFolderSiblings(this.props.folder, this.props.folders)
    if (next !== null) {
      this.run(() =>
        this.props.dispatcher.moveFolderRelativeTo(
          this.props.folder,
          next,
          'after'
        )
      )
    }
  }

  private onRename = () =>
    this.run(() =>
      this.props.dispatcher.showPopup({
        type: PopupType.RenameRepositoryFolder,
        folder: this.props.folder,
      })
    )

  private onDelete = () =>
    this.run(() =>
      this.props.dispatcher.showPopup({
        type: PopupType.DeleteRepositoryFolder,
        folder: this.props.folder,
      })
    )

  private renderColorSection() {
    const current = this.props.folder.color?.toLowerCase() ?? null

    return (
      <div className="folder-menu-colors">
        <div className="folder-menu-swatches">
          {FolderColors.map(c => {
            const selected = current === c.value.toLowerCase()
            return (
              <button
                key={c.value}
                type="button"
                className={'folder-menu-swatch' + (selected ? ' selected' : '')}
                style={{ backgroundColor: c.value }}
                aria-label={selected ? `${c.name} (click to clear)` : c.name}
                aria-pressed={selected}
                data-color={c.value}
                onClick={this.onSwatchClick}
              >
                {selected && <Octicon symbol={octicons.check} />}
              </button>
            )
          })}
        </div>
        <div className="folder-menu-custom">
          <label className="folder-menu-custom-input">
            <span
              className="folder-menu-custom-swatch"
              style={{ backgroundColor: this.props.folder.color ?? undefined }}
            />
            Custom
            <input
              type="color"
              value={this.props.folder.color ?? DefaultCustomColor}
              onChange={this.onCustomColorChange}
            />
          </label>
          <button
            type="button"
            className="folder-menu-remove-color"
            aria-label="Remove color"
            disabled={current === null}
            onClick={this.onRemoveColor}
          >
            <Octicon symbol={octicons.trash} />
          </button>
        </div>
      </div>
    )
  }

  public render() {
    const { folder, folders } = this.props
    const { previous, next } = getFolderSiblings(folder, folders)

    return (
      <div
        className="folder-menu"
        ref={this.menuRef}
        role="menu"
        tabIndex={-1}
        style={{ top: this.state.top, left: this.state.left }}
      >
        <button
          type="button"
          className="folder-menu-item"
          onClick={this.onNewSubfolder}
        >
          New subfolder…
        </button>
        <button
          type="button"
          className="folder-menu-item"
          onClick={this.onNewFolderBefore}
        >
          New folder before…
        </button>
        <button
          type="button"
          className="folder-menu-item"
          onClick={this.onNewFolderAfter}
        >
          New folder after…
        </button>

        <div className="folder-menu-separator" />

        <button
          type="button"
          className="folder-menu-item"
          onClick={this.onCloneRepository}
        >
          Clone repository…
        </button>
        <button
          type="button"
          className="folder-menu-item"
          onClick={this.onAddRepository}
        >
          Add existing repository…
        </button>

        <div className="folder-menu-separator" />

        <button
          type="button"
          className="folder-menu-item"
          disabled={previous === null}
          onClick={this.onMoveUp}
        >
          Move up
        </button>
        <button
          type="button"
          className="folder-menu-item"
          disabled={next === null}
          onClick={this.onMoveDown}
        >
          Move down
        </button>

        <div className="folder-menu-separator" />

        {this.renderColorSection()}

        <div className="folder-menu-separator" />

        <button
          type="button"
          className="folder-menu-item"
          onClick={this.onRename}
        >
          Rename folder…
        </button>
        <button
          type="button"
          className="folder-menu-item destructive"
          onClick={this.onDelete}
        >
          Delete folder…
        </button>
      </div>
    )
  }
}
