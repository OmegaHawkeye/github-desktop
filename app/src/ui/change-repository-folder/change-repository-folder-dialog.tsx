import * as React from 'react'

import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { Folder } from '../../models/folder'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'

interface IChangeRepositoryFolderProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
  readonly repository?: Repository
  readonly folder?: Folder
  readonly initialName?: string
}

interface IChangeRepositoryFolderState {
  readonly name: string
  readonly isSubmitting: boolean
  readonly error: string | null
}

export class ChangeRepositoryFolder extends React.Component<
  IChangeRepositoryFolderProps,
  IChangeRepositoryFolderState
> {
  public constructor(props: IChangeRepositoryFolderProps) {
    super(props)

    this.state = {
      name: props.folder?.name ?? props.initialName ?? '',
      isSubmitting: false,
      error: null,
    }
  }

  public render() {
    const isRename = this.props.folder !== undefined
    const verb = isRename ? 'Rename' : 'Create'

    return (
      <Dialog
        id="change-repository-folder"
        title={
          __DARWIN__ ? `${verb} Repository Folder` : `${verb} repository folder`
        }
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
        disabled={this.state.isSubmitting}
        dismissDisabled={this.state.isSubmitting}
        loading={this.state.isSubmitting}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        <DialogContent>
          <p>
            <TextBox
              ariaLabel="Folder name"
              value={this.state.name}
              onValueChanged={this.onNameChanged}
            />
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? `${verb} Folder` : `${verb} folder`}
            okButtonDisabled={
              this.state.name.trim().length === 0 || this.state.isSubmitting
            }
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onNameChanged = (name: string) => {
    this.setState({ name, error: null })
  }

  private onSubmit = async () => {
    const name = this.state.name.trim()
    if (name.length === 0) {
      return
    }

    this.setState({ isSubmitting: true, error: null })

    try {
      if (this.props.folder) {
        await this.props.dispatcher.renameRepositoryFolder(
          this.props.folder,
          name
        )
      } else {
        const folder = await this.props.dispatcher.createRepositoryFolder(name)
        if (this.props.repository) {
          await this.props.dispatcher.updateRepositoryFolder(
            this.props.repository,
            folder.id
          )
        }
      }

      this.props.onDismissed()
    } catch (error) {
      this.setState({
        isSubmitting: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to save the repository folder.',
      })
    }
  }
}
