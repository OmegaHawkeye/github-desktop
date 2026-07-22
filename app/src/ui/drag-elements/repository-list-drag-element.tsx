import * as React from 'react'

import { Folder } from '../../models/folder'
import { Repository } from '../../models/repository'
import { Octicon, iconForRepository } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

type IRepositoryListDragElementProps =
  | { readonly kind: 'repository'; readonly repository: Repository }
  | { readonly kind: 'folder'; readonly folder: Folder }

export class RepositoryListDragElement extends React.PureComponent<IRepositoryListDragElementProps> {
  public render() {
    const { kind } = this.props
    const icon =
      kind === 'repository'
        ? iconForRepository(this.props.repository)
        : octicons.fileDirectoryFill
    const label =
      kind === 'repository' ? this.props.repository.name : this.props.folder.name
    const description = kind === 'repository' ? this.props.repository.path : 'Folder'

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
