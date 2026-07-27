import { SemVer } from 'semver'

/**
 * [OmegaHawkeye fork] A newer fork release than the one currently running.
 * Returned by an {@link IForkUpdateProvider} when an update is available.
 */
export interface IForkUpdate {
  /** Parsed fork version, e.g. SemVer of `1.2.0` from tag `omega-v1.2.0`. */
  readonly version: SemVer
  /** The raw git tag, e.g. `omega-v1.2.0`. */
  readonly tag: string
  /** Human-readable release name/title. */
  readonly name: string
  /** URL of the release page (shown via "What's new"). */
  readonly notesUrl: string
  /**
   * Direct download URL for a matching per-platform asset, or `null` if no
   * asset matched (in which case consumers fall back to `notesUrl`).
   */
  readonly downloadUrl: string | null
  /** When the release was published. */
  readonly publishedAt: Date
  /** Whether this is a prerelease (`omega-v1.2.0-beta.1`). */
  readonly isPrerelease: boolean
}

/**
 * [OmegaHawkeye fork] The swap seam. A source of fork update information.
 *
 * `GitHubReleasesProvider` is the only implementation today; to move off GitHub
 * (Gitea, S3-hosted JSON, a private endpoint…) write another class that
 * satisfies this interface and swap it in `fork-update-checker.ts` — nothing
 * else in the app changes.
 */
export interface IForkUpdateProvider {
  /**
   * Resolve the newest available fork release.
   *
   * @param currentVersion The running build's fork version (bare SemVer).
   * @returns The update if a newer release exists, otherwise `null`.
   */
  checkForUpdate(currentVersion: string): Promise<IForkUpdate | null>
}
