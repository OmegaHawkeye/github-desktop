/**
 * [OmegaHawkeye fork] Configuration for the fork update-notify feature.
 *
 * This whole folder (`app/src/lib/fork-updates/`) plus the `enableForkUpdates()`
 * feature flag and one call site in `app.tsx` are the entirety of the feature.
 * Delete them to revert to stock GitHub Desktop behaviour.
 */

/**
 * The fork's own version line, independent from upstream's `release-x.y.z`
 * numbering. Bump this every time you publish a new `omega-v<semver>` release
 * so the running build knows what "current" is.
 *
 * Keep it a bare SemVer string (no `omega-v` prefix) — the prefix lives only on
 * the git tags / GitHub releases.
 */
export const FORK_CURRENT_VERSION = '1.0.0'

/**
 * Prefix that distinguishes fork release tags (`omega-v1.2.0`) from upstream's
 * (`release-3.6.4`). The checker only ever considers tags starting with this,
 * so upstream tags are ignored and can never trigger a fork update.
 */
export const FORK_TAG_PREFIX = 'omega-v'

/** GitHub repository that publishes the fork's releases. */
export const FORK_REPO_OWNER = 'OmegaHawkeye'
export const FORK_REPO_NAME = 'github-desktop'

/**
 * Whether prerelease tags (`omega-v1.2.0-beta.1`) should be offered as updates.
 * Off by default so testers only see stable fork builds; flip on for a beta
 * channel.
 */
export const FORK_INCLUDE_PRERELEASES = false

/** How often to check for a new fork release while the app is running. */
export const FORK_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
