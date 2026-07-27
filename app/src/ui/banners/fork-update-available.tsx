import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Banner } from './banner'
import { LinkButton } from '../lib/link-button'
import { shell } from '../../lib/app-shell'

interface IForkUpdateAvailableProps {
  /** Release title, e.g. `omega-v1.2.0`. */
  readonly releaseName: string
  /** URL of the release page ("What's new"). */
  readonly notesUrl: string
  /** Direct asset download URL, or `null` to fall back to notesUrl. */
  readonly downloadUrl: string | null
  readonly onDismissed: () => void
}

/**
 * [OmegaHawkeye fork] In-app banner (surface A) telling the user a newer fork
 * build is available. Notify-only: buttons open the fork's GitHub release page /
 * download asset in the browser — this does not silently swap the binary.
 */
export class ForkUpdateAvailable extends React.Component<IForkUpdateAvailableProps> {
  private onDownload = () => {
    shell.openExternal(this.props.downloadUrl ?? this.props.notesUrl)
  }

  public render() {
    return (
      <Banner
        id="fork-update-available"
        className="fork-update-banner"
        dismissable={true}
        onDismissed={this.props.onDismissed}
      >
        <span className="fork-update-badge" aria-hidden={true}>
          <Octicon symbol={octicons.desktopDownload} />
        </span>
        <span className="fork-update-message">
          New version available: {this.props.releaseName}
        </span>
        <LinkButton
          className="fork-update-action ghost"
          uri={this.props.notesUrl}
        >
          What's new
        </LinkButton>
        <LinkButton
          className="fork-update-action primary"
          onClick={this.onDownload}
        >
          Download
        </LinkButton>
      </Banner>
    )
  }
}
