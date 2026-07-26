import * as React from 'react'

import { Folder } from '../../models/folder'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Ref } from '../lib/ref'

interface IMoveRepositoryToFolderProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly folder: Folder
  readonly onDismissed: () => void
}

/**
 * Shown when the user adds a repository that is already in the app into a
 * folder. If the repository is already in the target folder it simply informs
 * the user; otherwise it offers to move the repository into the folder.
 */
export class MoveRepositoryToFolder extends React.Component<IMoveRepositoryToFolderProps> {
  private get isAlreadyInFolder(): boolean {
    return this.props.repository.folderID === this.props.folder.id
  }

  private get title(): string {
    if (this.isAlreadyInFolder) {
      return __DARWIN__
        ? 'Repository Already Added'
        : 'Repository already added'
    }
    return __DARWIN__ ? 'Move Repository?' : 'Move repository?'
  }

  public render() {
    const { repository, folder } = this.props
    const name = repository.alias ?? repository.name
    const alreadyInFolder = this.isAlreadyInFolder

    return (
      <Dialog
        id="move-repository-to-folder"
        title={this.title}
        type="normal"
        role="alertdialog"
        ariaDescribedBy="move-repository-to-folder-message"
        onDismissed={this.props.onDismissed}
        onSubmit={alreadyInFolder ? this.props.onDismissed : this.onMove}
      >
        <DialogContent>
          <p id="move-repository-to-folder-message">
            {alreadyInFolder ? (
              <>
                <Ref>{name}</Ref> is already in the <Ref>{folder.name}</Ref>{' '}
                folder.
              </>
            ) : (
              <>
                <Ref>{name}</Ref> is already added to GitHub Desktop. Do you
                want to move it to the <Ref>{folder.name}</Ref> folder?
              </>
            )}
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={alreadyInFolder ? 'Ok' : 'Move'}
            cancelButtonVisible={!alreadyInFolder}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onMove = () => {
    this.props.dispatcher.updateRepositoryFolder(
      this.props.repository,
      this.props.folder.id
    )
    this.props.onDismissed()
  }
}
