import { Repository } from '../../models/repository'
import { IMenuItem } from '../../lib/menu-item'
import { Repositoryish } from './group-repositories'
import { clipboard } from 'electron'
import {
  RevealInFileManagerLabel,
  DefaultEditorLabel,
  DefaultShellLabel,
} from '../lib/context-menu'
import { Folder } from '../../models/folder'

interface IRepositoryListItemContextMenuConfig {
  repository: Repositoryish
  shellLabel: string | undefined
  externalEditorLabel: string | undefined
  askForConfirmationOnRemoveRepository: boolean
  onViewOnGitHub: (repository: Repositoryish) => void
  onOpenInShell: (repository: Repositoryish) => void
  onShowRepository: (repository: Repositoryish) => void
  onOpenInExternalEditor: (repository: Repositoryish) => void
  onRemoveRepository: (repository: Repositoryish) => void
  onChangeRepositoryAlias: (repository: Repository) => void
  onRemoveRepositoryAlias: (repository: Repository) => void
  onCreateRepositoryFolder: (repository: Repository) => void
  onUpdateRepositoryFolder: (
    repository: Repository,
    folderID: number | null
  ) => void
  folders: ReadonlyArray<Folder>
}

export const generateRepositoryListContextMenu = (
  config: IRepositoryListItemContextMenuConfig
) => {
  const { repository } = config
  const missing = repository instanceof Repository && repository.missing
  const github =
    repository instanceof Repository && repository.gitHubRepository != null
  const openInExternalEditor = config.externalEditorLabel
    ? `Open in ${config.externalEditorLabel}`
    : DefaultEditorLabel
  const openInShell = config.shellLabel
    ? `Open in ${config.shellLabel}`
    : DefaultShellLabel

  const items: ReadonlyArray<IMenuItem> = [
    ...buildAliasMenuItems(config),
    ...buildFolderMenuItems(config),
    {
      label: __DARWIN__ ? 'Copy Repo Name' : 'Copy repo name',
      action: () => clipboard.writeText(repository.name),
    },
    {
      label: __DARWIN__ ? 'Copy Repo Path' : 'Copy repo path',
      action: () => clipboard.writeText(repository.path),
    },
    { type: 'separator' },
    {
      label: 'View on GitHub',
      action: () => config.onViewOnGitHub(repository),
      enabled: github,
    },
    {
      label: openInShell,
      action: () => config.onOpenInShell(repository),
      enabled: !missing,
    },
    {
      label: RevealInFileManagerLabel,
      action: () => config.onShowRepository(repository),
      enabled: !missing,
    },
    {
      label: openInExternalEditor,
      action: () => config.onOpenInExternalEditor(repository),
      enabled: !missing,
    },
    { type: 'separator' },
    {
      label: config.askForConfirmationOnRemoveRepository ? 'Remove…' : 'Remove',
      action: () => config.onRemoveRepository(repository),
    },
  ]

  return items
}

const buildAliasMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const verb = repository.alias == null ? 'Create' : 'Change'
  const items: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? `${verb} Alias` : `${verb} alias`,
      action: () => config.onChangeRepositoryAlias(repository),
    },
  ]

  if (repository.alias !== null) {
    items.push({
      label: __DARWIN__ ? 'Remove Alias' : 'Remove alias',
      action: () => config.onRemoveRepositoryAlias(repository),
    })
  }

  return items
}

const buildFolderMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const submenu: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? 'No Folder' : 'No folder',
      action: () => config.onUpdateRepositoryFolder(repository, null),
      type: 'checkbox',
      checked: repository.folderID === null,
    },
    ...config.folders.map(folder => ({
      label: folder.name,
      action: () => config.onUpdateRepositoryFolder(repository, folder.id),
      type: 'checkbox' as const,
      checked: repository.folderID === folder.id,
    })),
    { type: 'separator' as const },
    {
      label: __DARWIN__ ? 'New Folder…' : 'New folder…',
      action: () => config.onCreateRepositoryFolder(repository),
    },
  ]

  return [
    {
      label: __DARWIN__ ? 'Move to Folder' : 'Move to folder',
      submenu,
    },
  ]
}
