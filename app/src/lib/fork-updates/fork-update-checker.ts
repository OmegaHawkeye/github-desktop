import { Banner, BannerType } from '../../models/banner'
import { shell } from '../app-shell'
import { showNotification } from '../notifications/show-notification'
import {
  FORK_CURRENT_VERSION,
  FORK_UPDATE_CHECK_INTERVAL_MS,
} from './fork-config'
import { GitHubReleasesProvider } from './github-releases-provider'
import { IForkUpdate, IForkUpdateProvider } from './types'

/** localStorage key recording the last fork version we sent an OS toast for. */
const lastNotifiedForkVersionKey = 'last-notified-fork-version'

/**
 * Minimal slice of the Dispatcher the checker needs, so this lib module doesn't
 * depend on the whole UI dispatcher.
 */
interface IBannerDispatcher {
  setBanner(banner: Banner): void
}

/**
 * [OmegaHawkeye fork] Periodically asks an {@link IForkUpdateProvider} whether a
 * newer fork build exists and, when one does, surfaces it two ways:
 *
 *  A. an in-app banner (persistent until dismissed), and
 *  B. a native OS toast (fired once per new version, even if unfocused).
 *
 * Swap the provider below to change where updates come from.
 */
class ForkUpdateChecker {
  private readonly provider: IForkUpdateProvider = new GitHubReleasesProvider()
  private intervalHandle: number | null = null
  private dispatcher: IBannerDispatcher | null = null

  /** Version we've already raised the banner for this session (dedupe). */
  private bannerShownForVersion: string | null = null

  /**
   * Begin checking: once immediately, then on an interval. Safe to call once at
   * app startup. No-op if already started.
   */
  public start(dispatcher: IBannerDispatcher) {
    if (this.intervalHandle !== null) {
      return
    }

    this.dispatcher = dispatcher
    this.check()
    this.intervalHandle = window.setInterval(
      () => this.check(),
      FORK_UPDATE_CHECK_INTERVAL_MS
    )
  }

  public stop() {
    if (this.intervalHandle !== null) {
      window.clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  /** Run a single check now (also used by a manual "Check for updates"). */
  public async check() {
    try {
      const update = await this.provider.checkForUpdate(FORK_CURRENT_VERSION)
      if (update === null) {
        return
      }
      this.showBanner(update)
      this.maybeShowNotification(update)
    } catch (e) {
      log.warn('[fork-updates] check failed', e)
    }
  }

  // Surface A — in-app banner. Shown once per version so we don't re-raise a
  // banner the user has dismissed on every interval tick.
  private showBanner(update: IForkUpdate) {
    if (this.dispatcher === null) {
      return
    }
    if (this.bannerShownForVersion === update.version.raw) {
      return
    }
    this.bannerShownForVersion = update.version.raw

    this.dispatcher.setBanner({
      type: BannerType.ForkUpdateAvailable,
      releaseName: update.name,
      notesUrl: update.notesUrl,
      downloadUrl: update.downloadUrl,
    })
  }

  // Surface B — native OS toast. Fired at most once per version, ever
  // (persisted), so restarting the app doesn't re-toast the same release.
  private maybeShowNotification(update: IForkUpdate) {
    const alreadyNotified = localStorage.getItem(lastNotifiedForkVersionKey)
    if (alreadyNotified === update.version.raw) {
      return
    }
    localStorage.setItem(lastNotifiedForkVersionKey, update.version.raw)

    showNotification({
      title: 'Update available',
      body: `${update.name} is available. Click to see what's new and download.`,
      onClick: () => {
        shell.openExternal(update.downloadUrl ?? update.notesUrl)
      },
    })
  }
}

/** [OmegaHawkeye fork] Singleton fork update checker. */
export const forkUpdateChecker = new ForkUpdateChecker()
