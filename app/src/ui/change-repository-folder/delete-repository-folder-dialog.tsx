import * as React from 'react'

import { Folder } from '../../models/folder'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Ref } from '../lib/ref'

interface IDeleteRepositoryFolderProps {
  readonly dispatcher: Dispatcher
  readonly folder: Folder
  readonly onDismissed: () => void
}

interface IDeleteRepositoryFolderState {
  readonly isDeleting: boolean
}

export class DeleteRepositoryFolder extends React.Component<
  IDeleteRepositoryFolderProps,
  IDeleteRepositoryFolderState
> {
  public constructor(props: IDeleteRepositoryFolderProps) {
    super(props)
    this.state = { isDeleting: false }
  }

  public render() {
    return (
      <Dialog
        id="delete-repository-folder"
        title={
          __DARWIN__ ? 'Delete Repository Folder' : 'Delete repository folder'
        }
        type="warning"
        role="alertdialog"
        ariaDescribedBy="delete-repository-folder-confirmation"
        disabled={this.state.isDeleting}
        dismissDisabled={this.state.isDeleting}
        loading={this.state.isDeleting}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
      >
        <DialogContent>
          <p id="delete-repository-folder-confirmation">
            Are you sure you want to delete the folder{' '}
            <Ref>{this.props.folder.name}</Ref>?
          </p>
          <p>
            {this.props.folder.parentFolderID !== null
              ? 'Repositories and nested folders inside will be moved up to the parent folder.'
              : 'Repositories and nested folders inside will be moved out to the top level.'}
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText="Delete" />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    this.setState({ isDeleting: true })
    try {
      await this.props.dispatcher.deleteRepositoryFolder(this.props.folder)
      this.props.onDismissed()
    } catch (error) {
      this.setState({ isDeleting: false })
      await this.props.dispatcher.presentError(
        error instanceof Error
          ? error
          : new Error('Unable to delete the repository folder.')
      )
    }
  }
}
