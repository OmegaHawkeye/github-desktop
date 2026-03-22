import * as React from 'react'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { DialogContent } from '../dialog'
import { Ref } from '../lib/ref'
import { Select } from '../lib/select'
import { Folder } from '../../models/folder'

interface ICloneGenericRepositoryProps {
  /** The URL to clone. */
  readonly url: string

  /** The path to which the repository should be cloned. */
  readonly path: string

  /** Called when the destination path changes. */
  readonly onPathChanged: (path: string) => void

  /** Called when the URL to clone changes. */
  readonly onUrlChanged: (url: string) => void

  /**
   * Called when the user should be prompted to choose a directory to clone to.
   */
  readonly onChooseDirectory: () => Promise<string | undefined>
  readonly folders: ReadonlyArray<Folder>
  readonly selectedFolderID: number | null
  readonly onSelectedFolderChanged: (folderID: number | null) => void
}

/** The component for cloning a repository. */
export class CloneGenericRepository extends React.Component<
  ICloneGenericRepositoryProps,
  {}
> {
  public render() {
    return (
      <DialogContent className="clone-generic-repository-content">
        <Row>
          <TextBox
            placeholder="URL or username/repository"
            value={this.props.url}
            onValueChanged={this.onUrlChanged}
            autoFocus={true}
            label={
              <div className="clone-url-textbox-label">
                <p>Repository URL or GitHub username and repository</p>
                <p>
                  (<Ref>hubot/cool-repo</Ref>)
                </p>
              </div>
            }
          />
        </Row>

        <Row>
          <TextBox
            value={this.props.path}
            label={__DARWIN__ ? 'Local Path' : 'Local path'}
            placeholder="repository path"
            onValueChanged={this.props.onPathChanged}
          />
          <Button onClick={this.props.onChooseDirectory}>Choose…</Button>
        </Row>
        <Row>
          <Select
            label={__DARWIN__ ? 'Repository Folder' : 'Repository folder'}
            value={this.props.selectedFolderID?.toString() ?? ''}
            onChange={this.onFolderChanged}
          >
            <option value="">No folder</option>
            {this.props.folders.map(folder => (
              <option key={folder.id} value={folder.id.toString()}>
                {folder.name}
              </option>
            ))}
          </Select>
        </Row>
      </DialogContent>
    )
  }

  private onUrlChanged = (url: string) => {
    this.props.onUrlChanged(url)
  }

  private onFolderChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    this.props.onSelectedFolderChanged(value === '' ? null : parseInt(value, 10))
  }
}
