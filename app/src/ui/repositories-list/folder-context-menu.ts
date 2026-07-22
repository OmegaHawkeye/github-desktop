import { IMenuItem } from '../../lib/menu-item'
import { Folder } from '../../models/folder'
import { Repository } from '../../models/repository'
import { PopupType } from '../../models/popup'
import { Dispatcher } from '../dispatcher'
import { getFoldersInTreeOrder, getFolderPathLabel } from './group-repositories'

/** Callbacks required to build the "Move to folder" submenu. */
export interface IFolderMenuActions {
  readonly onUpdateFolder: (folderID: number | null) => void
  readonly onCreateFolder: () => void
}

/** The default folder color swatches offered in the folder menu. */
export const FolderColors: ReadonlyArray<{
  readonly name: string
  readonly value: string
}> = [
  { name: 'Red', value: '#d1242f' },
  { name: 'Orange', value: '#bc4c00' },
  { name: 'Yellow', value: '#eac54f' },
  { name: 'Green', value: '#1a7f37' },
  { name: 'Blue', value: '#0969da' },
  { name: 'Purple', value: '#8250df' },
  { name: 'Pink', value: '#bf3989' },
]

/**
 * Expands a `#rgb` shorthand to `#rrggbb`. Returns the input unchanged if it
 * is already 6 hex digits (after stripping the `#`), or null if the input is
 * not a recognised hex color.
 */
function normalizeHexColor(hexColor: string): string | null {
  const hex = hexColor.replace('#', '')
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map(c => c + c)
          .join('')
      : hex
  return normalized.length === 6 ? normalized : null
}

/** Converts a `#rrggbb` (or `#rgb`) color to an `rgba()` string with `alpha`. */
export function hexToRgba(hexColor: string, alpha: number): string {
  const normalized = normalizeHexColor(hexColor)
  if (normalized === null) {
    return hexColor
  }
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Returns a readable (black or white) text color for content placed on top of
 * the given hex background color, based on its relative luminance.
 */
export function getReadableTextColor(hexColor: string): string {
  const normalized = normalizeHexColor(hexColor)
  if (normalized === null) {
    return '#ffffff'
  }
  const r = parseInt(normalized.slice(0, 2), 16) / 255
  const g = parseInt(normalized.slice(2, 4), 16) / 255
  const b = parseInt(normalized.slice(4, 6), 16) / 255

  // Perceived luminance (sRGB coefficients).
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.6 ? '#1f2328' : '#ffffff'
}

/** The previous/next sibling of a folder in tree order (for move up/down). */
export function getFolderSiblings(
  folder: Folder,
  folders: ReadonlyArray<Folder>
): { readonly previous: Folder | null; readonly next: Folder | null } {
  const siblings = getFoldersInTreeOrder(folders).filter(
    f => (f.parentFolderID ?? null) === (folder.parentFolderID ?? null)
  )
  const index = siblings.findIndex(f => f.id === folder.id)
  return {
    previous: index > 0 ? siblings[index - 1] : null,
    next:
      index !== -1 && index < siblings.length - 1 ? siblings[index + 1] : null,
  }
}

/**
 * Menu item that opens the "create folder" dialog. When `parentFolderID` is
 * provided the new folder is created nested under that folder.
 */
export function getNewFolderMenuItem(
  dispatcher: Dispatcher,
  parentFolderID: number | null = null
): IMenuItem {
  return {
    label: __DARWIN__ ? 'New Folder…' : 'New folder…',
    action: () =>
      dispatcher.showPopup({
        type: PopupType.CreateRepositoryFolder,
        parentFolderID,
      }),
  }
}

/**
 * A "Move to folder" submenu item for a repository, listing "No folder", every
 * existing folder, and an option to create a new folder for the repository.
 */
export function getMoveRepositoryToFolderMenuItem(
  repository: Repository,
  folders: ReadonlyArray<Folder>,
  actions: IFolderMenuActions
): IMenuItem {
  const submenu: IMenuItem[] = [
    {
      label: __DARWIN__ ? 'No Folder' : 'No folder',
      action: () => actions.onUpdateFolder(null),
      type: 'checkbox',
      checked: repository.folderID === null,
    },
    ...getFoldersInTreeOrder(folders).map(folder => ({
      label: getFolderPathLabel(folder, folders),
      action: () => actions.onUpdateFolder(folder.id),
      type: 'checkbox' as const,
      checked: repository.folderID === folder.id,
    })),
    { type: 'separator' },
    {
      label: __DARWIN__ ? 'New Folder…' : 'New folder…',
      action: () => actions.onCreateFolder(),
    },
  ]

  return {
    label: __DARWIN__ ? 'Move to Folder' : 'Move to folder',
    submenu,
  }
}
