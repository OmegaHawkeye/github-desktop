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

  private onSwatchClick = (value: string) => {
    const current = this.props.folder.color?.toLowerCase() ?? null
    // Toggle: clicking the already-selected color clears it.
    this.setColor(current === value.toLowerCase() ? null : value)
    this.props.onClose()
  }

  private onCustomColorChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setColor(event.currentTarget.value)
  }

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
                className={
                  'folder-menu-swatch' + (selected ? ' selected' : '')
                }
                style={{ backgroundColor: c.value }}
                title={selected ? `${c.name} (click to clear)` : c.name}
                aria-label={c.name}
                aria-pressed={selected}
                onClick={() => this.onSwatchClick(c.value)}
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
            title="Remove color"
            aria-label="Remove color"
            disabled={current === null}
            onClick={() => this.setColor(null)}
          >
            <Octicon symbol={octicons.trash} />
          </button>
        </div>
      </div>
    )
  }

  public render() {
    const { folder, folders, dispatcher } = this.props
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
          onClick={() =>
            this.run(() =>
              dispatcher.showPopup({
                type: PopupType.CreateRepositoryFolder,
                parentFolderID: folder.id,
              })
            )
          }
        >
          New subfolder…
        </button>
        <button
          type="button"
          className="folder-menu-item"
          onClick={() =>
            this.run(() =>
              dispatcher.showPopup({
                type: PopupType.CreateRepositoryFolder,
                parentFolderID: folder.parentFolderID,
                positionRelativeTo: { folder, position: 'before' },
              })
            )
          }
        >
          New folder before…
        </button>
        <button
          type="button"
          className="folder-menu-item"
          onClick={() =>
            this.run(() =>
              dispatcher.showPopup({
                type: PopupType.CreateRepositoryFolder,
                parentFolderID: folder.parentFolderID,
                positionRelativeTo: { folder, position: 'after' },
              })
            )
          }
        >
          New folder after…
        </button>

        <div className="folder-menu-separator" />

        <button
          type="button"
          className="folder-menu-item"
          onClick={() =>
            this.run(() =>
              dispatcher.showPopup({
                type: PopupType.CloneRepository,
                initialURL: null,
                initialFolderID: folder.id,
              })
            )
          }
        >
          Clone repository…
        </button>
        <button
          type="button"
          className="folder-menu-item"
          onClick={() =>
            this.run(() =>
              dispatcher.showPopup({
                type: PopupType.AddRepository,
                folderID: folder.id,
              })
            )
          }
        >
          Add existing repository…
        </button>

        <div className="folder-menu-separator" />

        <button
          type="button"
          className="folder-menu-item"
          disabled={previous === null}
          onClick={() =>
            previous !== null &&
            this.run(() =>
              dispatcher.moveFolderRelativeTo(folder, previous, 'before')
            )
          }
        >
          Move up
        </button>
        <button
          type="button"
          className="folder-menu-item"
          disabled={next === null}
          onClick={() =>
            next !== null &&
            this.run(() =>
              dispatcher.moveFolderRelativeTo(folder, next, 'after')
            )
          }
        >
          Move down
        </button>

        <div className="folder-menu-separator" />

        {this.renderColorSection()}

        <div className="folder-menu-separator" />

        <button
          type="button"
          className="folder-menu-item"
          onClick={() =>
            this.run(() =>
              dispatcher.showPopup({
                type: PopupType.RenameRepositoryFolder,
                folder,
              })
            )
          }
        >
          Rename folder…
        </button>
        <button
          type="button"
          className="folder-menu-item destructive"
          onClick={() =>
            this.run(() =>
              dispatcher.showPopup({
                type: PopupType.DeleteRepositoryFolder,
                folder,
              })
            )
          }
        >
          Delete folder…
        </button>
      </div>
    )
  }
}
