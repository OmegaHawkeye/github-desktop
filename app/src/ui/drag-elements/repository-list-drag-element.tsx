import * as React from 'react'

import { Folder } from '../../models/folder'
import { Repository } from '../../models/repository'
import { Octicon, iconForRepository } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IRepositoryListDragElementProps {
  readonly repository?: Repository
  readonly folder?: Folder
}

export class RepositoryListDragElement extends React.PureComponent<IRepositoryListDragElementProps> {
  public render() {
    const { repository, folder } = this.props
    const icon =
      repository !== undefined
        ? iconForRepository(repository)
        : octicons.fileDirectoryFill
    const label = repository?.name ?? folder?.name ?? ''
    const description = repository?.path ?? 'Folder'

    return (
      <div id="repository-list-drag-element">
        <div className="drag-item">
          <Octicon className="drag-icon" symbol={icon} />
          <div className="drag-item-text">
            <div className="drag-item-label">{label}</div>
            <div className="drag-item-description">{description}</div>
          </div>
        </div>
      </div>
    )
  }
}
