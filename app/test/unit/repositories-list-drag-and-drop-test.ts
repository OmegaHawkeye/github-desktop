import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'

import { dragAndDropManager } from '../../src/lib/drag-and-drop-manager'
import { DragType } from '../../src/models/drag-drop'
import { Folder } from '../../src/models/folder'
import { Repository } from '../../src/models/repository'
import { RepositoriesList } from '../../src/ui/repositories-list/repositories-list'
import {
  canDropRepositoryIntoFolder,
  getFolderDropPosition,
  getReorderedFolders,
} from '../../src/ui/repositories-list/repository-list-drag-and-drop'

describe('repository list drag and drop', () => {
  afterEach(() => {
    dragAndDropManager.setDragData(null)
  })

  it('calculates folder reorder positions from pointer location', () => {
    assert.equal(getFolderDropPosition({ top: 0, height: 20 }, 4), 'before')
    assert.equal(getFolderDropPosition({ top: 0, height: 20 }, 16), 'after')
    assert.equal(getFolderDropPosition({ top: 0, height: 20 }, 10), 'into')
  })

  it('reorders folders around the target folder', () => {
    const workFolder = new Folder(1, 'Work', 0)
    const personalFolder = new Folder(2, 'Personal', 1)
    const teamFolder = new Folder(3, 'Team', 2)

    const reordered = getReorderedFolders(
      [workFolder, personalFolder, teamFolder],
      workFolder,
      personalFolder,
      'after'
    )

    assert.deepEqual(
      reordered.map(folder => folder.name),
      ['Personal', 'Work', 'Team']
    )
  })

  it('dispatches repository folder updates on valid drops', () => {
    const folder = new Folder(1, 'Work', 0)
    const repository = new Repository('/work/repo', 1, null, false)
    const { list, repositoryFolderUpdates } = createList([folder])

    dragAndDropManager.setDragData({
      type: DragType.Repository,
      repository,
    })
    ;(list as any).onFolderDropTargetMouseUp(folder)({
      clientY: 10,
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0, height: 20 }),
      },
    })

    assert.deepEqual(repositoryFolderUpdates, [[repository.id, folder.id]])
    assert.equal(canDropRepositoryIntoFolder(repository, folder), true)
  })

  it('moves repositories into a folder from every header drop zone', () => {
    const folder = new Folder(1, 'Work', 0)
    const repository = new Repository('/work/repo', 1, null, false)
    const { list, repositoryFolderUpdates } = createList([folder])

    dragAndDropManager.setDragData({
      type: DragType.Repository,
      repository,
    })
    ;(list as any).onFolderDropTargetMouseUp(folder)({
      clientY: 1,
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0, height: 20 }),
      },
    })

    assert.deepEqual(repositoryFolderUpdates, [[repository.id, folder.id]])
  })

  it('ignores repository drops onto the current folder', () => {
    const folder = new Folder(1, 'Work', 0)
    const repository = new Repository(
      '/work/repo',
      1,
      null,
      false,
      null,
      {},
      false,
      folder.id
    )
    const { list, repositoryFolderUpdates } = createList([folder])

    dragAndDropManager.setDragData({
      type: DragType.Repository,
      repository,
    })
    ;(list as any).onFolderDropTargetMouseUp(folder)({
      clientY: 10,
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0, height: 20 }),
      },
    })

    assert.deepEqual(repositoryFolderUpdates, [])
    assert.equal(canDropRepositoryIntoFolder(repository, folder), false)
  })

  it('dispatches repository folder updates when dropped over a repo row in the folder', () => {
    const folder = new Folder(1, 'Work', 0)
    const repository = new Repository('/work/repo', 1, null, false)
    const { list, repositoryFolderUpdates } = createList([folder])

    dragAndDropManager.setDragData({
      type: DragType.Repository,
      repository,
    })
    ;(list as any).onFolderSectionDropTargetMouseUp(folder)({})

    assert.deepEqual(repositoryFolderUpdates, [[repository.id, folder.id]])
  })

  it('dispatches folder move relative to target', () => {
    const workFolder = new Folder(1, 'Work', 0)
    const personalFolder = new Folder(2, 'Personal', 1)
    const teamFolder = new Folder(3, 'Team', 2)
    const { list, folderMoves } = createList([
      workFolder,
      personalFolder,
      teamFolder,
    ])

    dragAndDropManager.setDragData({
      type: DragType.RepositoryFolder,
      folder: workFolder,
    })
    ;(list as any).onFolderDropTargetMouseUp(teamFolder)({
      clientY: 18,
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0, height: 20 }),
      },
    })

    assert.deepEqual(folderMoves, [
      { movedId: 1, targetId: 3, position: 'after' },
    ])
  })

  it('collapses folder groups to header-only when requested', () => {
    const folder = new Folder(1, 'Work', 0)
    const repository = new Repository(
      '/work/repo',
      1,
      null,
      false,
      null,
      {},
      false,
      folder.id
    )
    const { list } = createList([folder], [repository], [folder.id])

    const groups = (list as any).getRepositoryGroups(
      [repository],
      [folder],
      new Map(),
      [],
      [folder.id],
      true
    )

    assert.equal(groups[0].identifier.kind, 'folder')
    assert.equal(groups[0].items.length, 0)
  })

  it('hides descendant folder groups when a parent is collapsed', () => {
    const parent = new Folder(1, 'Parent', 0)
    const child = new Folder(2, 'Child', 0, parent.id)
    const repository = new Repository(
      '/work/repo',
      1,
      null,
      false,
      null,
      {},
      false,
      child.id
    )
    const { list } = createList([parent, child], [repository], [parent.id])

    const groups = (list as any).getRepositoryGroups(
      [repository],
      [parent, child],
      new Map(),
      [],
      [parent.id],
      true
    )

    assert.equal(groups.length, 1)
    assert.equal(groups[0].identifier.folder.id, parent.id)
    assert.equal(groups[0].items.length, 0)
  })
})

function createList(
  folders: ReadonlyArray<Folder>,
  repositories: ReadonlyArray<Repository> = [],
  collapsedFolderIDs: ReadonlyArray<number> = []
) {
  const repositoryFolderUpdates = new Array<[number, number | null]>()
  const folderMoves = new Array<{
    movedId: number
    targetId: number
    position: 'before' | 'after' | 'into'
  }>()

  const dispatcher = {
    updateRepositoryFolder: (
      repository: Repository,
      folderID: number | null
    ) => {
      repositoryFolderUpdates.push([repository.id, folderID])
      return Promise.resolve()
    },
    reorderRepositoryFolders: (_orderedFolders: ReadonlyArray<Folder>) => {
      return Promise.resolve()
    },
    moveFolderRelativeTo: (
      moved: Folder,
      target: Folder,
      position: 'before' | 'after' | 'into'
    ) => {
      folderMoves.push({
        movedId: moved.id,
        targetId: target.id,
        position,
      })
      return Promise.resolve()
    },
    setDragElement: () => undefined,
    clearDragElement: () => undefined,
    recordRepoClicked: () => undefined,
    showPopup: () => Promise.resolve(),
    deleteRepositoryFolder: () => Promise.resolve(),
    changeRepositoryAlias: () => Promise.resolve(),
    toggleCollapsedRepositoryFolder: () => Promise.resolve(),
    presentError: () => Promise.resolve(),
  }

  const list = new RepositoriesList({
    selectedRepository: null,
    repositories,
    folders,
    collapsedFolderIDs,
    recentRepositories: [],
    localRepositoryStateLookup: new Map(),
    onSelectionChanged: () => undefined,
    askForConfirmationOnRemoveRepository: false,
    onRemoveRepository: () => undefined,
    onShowRepository: () => undefined,
    onViewOnGitHub: () => undefined,
    onOpenInShell: () => undefined,
    onOpenInExternalEditor: () => undefined,
    onFilterTextChanged: () => undefined,
    filterText: '',
    dispatcher: dispatcher as any,
  })

  return { list, repositoryFolderUpdates, folderMoves }
}
