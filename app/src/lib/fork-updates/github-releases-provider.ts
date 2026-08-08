import { gt, SemVer, valid } from 'semver'
import { getUserAgent } from '../http'
import { IForkUpdate, IForkUpdateProvider } from './types'
import {
  FORK_INCLUDE_PRERELEASES,
  FORK_REPO_NAME,
  FORK_REPO_OWNER,
  FORK_TAG_PREFIX,
} from './fork-config'

/** Shape of the bits of the GitHub Releases API response we consume. */
interface IGitHubRelease {
  readonly tag_name: string
  readonly name: string | null
  readonly html_url: string
  readonly draft: boolean
  readonly prerelease: boolean
  readonly published_at: string | null
  readonly assets: ReadonlyArray<{
    readonly name: string
    readonly browser_download_url: string
  }>
}

/**
 * [OmegaHawkeye fork] Reads the fork's own GitHub Releases and reports the
 * newest one that is a valid `omega-v<semver>` tag newer than the running
 * build. This is the concrete {@link IForkUpdateProvider} in use today.
 */
export class GitHubReleasesProvider implements IForkUpdateProvider {
  public async checkForUpdate(
    currentVersion: string
  ): Promise<IForkUpdate | null> {
    const current = valid(currentVersion)
    if (current === null) {
      log.error(
        `[fork-updates] current fork version "${currentVersion}" is not valid semver; skipping check`
      )
      return null
    }

    const releases = await this.fetchReleases()
    if (releases === null) {
      return null
    }

    let best: IForkUpdate | null = null
    for (const release of releases) {
      const candidate = this.parseRelease(release)
      if (candidate === null) {
        continue
      }
      if (best === null || gt(candidate.version, best.version)) {
        best = candidate
      }
    }

    if (best === null) {
      return null
    }

    return gt(best.version, new SemVer(current)) ? best : null
  }

  private async fetchReleases(): Promise<ReadonlyArray<IGitHubRelease> | null> {
    const url = `https://api.github.com/repos/${FORK_REPO_OWNER}/${FORK_REPO_NAME}/releases?per_page=100`

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': getUserAgent(),
        },
      })

      if (!response.ok) {
        log.warn(
          `[fork-updates] releases request failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      return (await response.json()) as ReadonlyArray<IGitHubRelease>
    } catch (e) {
      log.warn('[fork-updates] error fetching releases', e)
      return null
    }
  }

  /** Turn a raw release into an {@link IForkUpdate}, or `null` if it should be ignored. */
  private parseRelease(release: IGitHubRelease): IForkUpdate | null {
    if (release.draft) {
      return null
    }
    if (release.prerelease && !FORK_INCLUDE_PRERELEASES) {
      return null
    }
    if (!release.tag_name.startsWith(FORK_TAG_PREFIX)) {
      return null
    }

    const rawVersion = release.tag_name.slice(FORK_TAG_PREFIX.length)
    if (valid(rawVersion) === null) {
      return null
    }

    return {
      version: new SemVer(rawVersion),
      tag: release.tag_name,
      name: release.name ?? release.tag_name,
      notesUrl: release.html_url,
      downloadUrl: this.pickAssetUrl(release) ?? release.html_url,
      publishedAt: release.published_at
        ? new Date(release.published_at)
        : new Date(0),
      isPrerelease: release.prerelease,
    }
  }

  /** Match a downloadable asset for the current platform, if any. */
  private pickAssetUrl(release: IGitHubRelease): string | null {
    const extensions = __WIN32__
      ? ['.exe', '.msi']
      : __DARWIN__
      ? ['.dmg', '.zip']
      : ['.appimage', '.deb', '.rpm']

    const match = release.assets.find(a =>
      extensions.some(ext => a.name.toLowerCase().endsWith(ext))
    )

    return match?.browser_download_url ?? null
  }
}
