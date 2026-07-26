import { Commit } from '../models/commit'

/**
 * The number of distinct colors used to render graph lanes before the palette
 * wraps around. Keep this in sync with the `--commit-graph-color-*` CSS
 * variables defined in `_commit-list.scss`.
 */
export const CommitGraphColorCount = 8

/**
 * Which portion of a row a graph edge covers.
 *
 * - `through`: a lane that passes straight through the row without touching the
 *   commit node (full height).
 * - `top`: an incoming branch line, from the top edge down to the node in the
 *   vertical center of the row.
 * - `bottom`: an outgoing line from the node down to a parent lane at the
 *   bottom edge.
 */
export type CommitGraphEdgeKind = 'through' | 'top' | 'bottom'

/**
 * A single line segment drawn within a commit row's graph cell.
 *
 * Coordinates are expressed as lane indices; the renderer is responsible for
 * mapping a lane index to an x pixel coordinate.
 */
export interface ICommitGraphEdge {
  /** Lane index at the top of the segment. */
  readonly from: number
  /** Lane index at the bottom of the segment. */
  readonly to: number
  /** Color index (0..CommitGraphColorCount - 1) used to stroke the segment. */
  readonly color: number
  /** Which portion of the row the segment covers. */
  readonly kind: CommitGraphEdgeKind
}

/** Layout information required to render one commit's row in the graph. */
export interface ICommitGraphRow {
  /** Lane index in which this commit's node is drawn. */
  readonly node: number
  /** Color index (0..CommitGraphColorCount - 1) of the node. */
  readonly color: number
  /** Line segments to render behind and around the node for this row. */
  readonly edges: ReadonlyArray<ICommitGraphEdge>
  /** Whether the commit is a merge commit (i.e. has two or more parents). */
  readonly isMerge: boolean
}

/** The computed lane layout for an ordered list of commits. */
export interface ICommitGraph {
  /** Per-SHA row layout, keyed by the commit's full SHA. */
  readonly rows: Map<string, ICommitGraphRow>
  /** The maximum number of concurrent lanes across all rows (graph width). */
  readonly laneCount: number
}

/** A reusable empty graph, e.g. when the feature is disabled. */
export const emptyCommitGraph: ICommitGraph = {
  rows: new Map<string, ICommitGraphRow>(),
  laneCount: 0,
}

/** The index of the last non-null entry plus one, i.e. the used width. */
function usedWidth(lanes: ReadonlyArray<string | null>): number {
  let width = 0
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i] !== null) {
      width = i + 1
    }
  }
  return width
}

/**
 * Compute a SourceTree-style lane layout for an ordered list of commits (newest
 * first, as returned by `git log`).
 *
 * The algorithm walks the commits from top to bottom while maintaining a set of
 * active "lanes". Each lane is reserved for the SHA of the commit it expects to
 * reach next. When a commit is reached, its first parent inherits the commit's
 * lane (keeping the branch color) and any additional parents open new lanes,
 * producing the familiar branch/merge weave. Lanes reserved for the same SHA
 * converge into a single node when that commit is drawn.
 *
 * Only the parent SHAs already carried on each {@link Commit} are used, so no
 * additional git invocations are required. Parents that fall outside the loaded
 * window simply leave a lane running off the bottom of the list, exactly as a
 * truncated history looks in SourceTree; the lane resolves once more commits are
 * loaded and the graph is recomputed.
 */
export function buildCommitGraph(
  commitSHAs: ReadonlyArray<string>,
  commitLookup: Map<string, Commit>
): ICommitGraph {
  if (commitSHAs.length === 0) {
    return emptyCommitGraph
  }

  // `lanes[i]` is the SHA the lane is currently waiting to draw, or null when
  // the lane is free. `laneColors[i]` is the color index assigned to that lane.
  // Lanes keep a stable column for their whole lifetime, which keeps the graph
  // visually calm as the user scrolls.
  const lanes: Array<string | null> = []
  const laneColors: Array<number> = []
  let nextColor = 0

  const rows = new Map<string, ICommitGraphRow>()
  let laneCount = 0

  const firstFreeLane = () => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) {
        return i
      }
    }
    return lanes.length
  }

  const takeColor = () => {
    const color = nextColor
    nextColor = (nextColor + 1) % CommitGraphColorCount
    return color
  }

  for (const sha of commitSHAs) {
    const commit = commitLookup.get(sha)

    // Snapshot the lane arrangement entering the row (the top of the cell)
    // before we mutate it for this commit.
    const incoming = lanes.slice()
    const incomingColors = laneColors.slice()

    // Find (or allocate) the lane this commit lives in. Multiple lanes may be
    // reserved for the same SHA (branches merging back together); the leftmost
    // becomes the node's lane and the rest converge into it.
    let node = incoming.indexOf(sha)
    let color: number
    if (node === -1) {
      // A branch tip we have not seen referenced yet: give it a fresh lane.
      node = firstFreeLane()
      color = takeColor()
      lanes[node] = sha
      laneColors[node] = color
    } else {
      color = laneColors[node]
    }

    const parents = commit?.parentSHAs ?? []
    const isMerge = parents.length > 1

    // Free every lane currently reserved for this commit; the first parent
    // re-occupies the node lane below. This collapses converging branches.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === sha) {
        lanes[i] = null
      }
    }

    // Assign lanes to the parents, remembering the column each parent's line
    // leaves this row in. Several parents/branches can be reserved for the same
    // SHA (branches that share an ancestor); we record the concrete column here
    // so the outgoing edges below connect to the right lane rather than guessing
    // via a SHA lookup, which would collapse onto a duplicate reservation.
    const parentColumns = new Map<string, number>()
    parents.forEach((parent, index) => {
      if (parentColumns.has(parent)) {
        return
      }
      if (index === 0) {
        // The first parent continues the current branch in the node's lane and
        // keeps its color.
        lanes[node] = parent
        laneColors[node] = color
        parentColumns.set(parent, node)
      } else {
        const existing = lanes.indexOf(parent)
        if (existing !== -1) {
          // A lane is already waiting for this parent: connect the merge line to
          // that existing lane instead of opening a duplicate.
          parentColumns.set(parent, existing)
        } else {
          // A merged-in branch that isn't already heading somewhere: open a new
          // colored lane for it.
          const lane = firstFreeLane()
          lanes[lane] = parent
          laneColors[lane] = takeColor()
          parentColumns.set(parent, lane)
        }
      }
    })

    // Snapshot the lane arrangement leaving the row (the bottom of the cell).
    const outgoing = lanes.slice()

    const edges: Array<ICommitGraphEdge> = []

    // 1. Lanes that pass straight through the row without touching the node. A
    //    pass-through lane keeps its column for its whole lifetime, so it is
    //    always drawn as a straight vertical segment. (Resolving the column via
    //    a SHA lookup would collapse onto a duplicate reservation of the same
    //    commit and paint stray diagonal lines that connect to no node.)
    for (let i = 0; i < incoming.length; i++) {
      const laneSha = incoming[i]
      if (laneSha === null || laneSha === sha) {
        continue
      }
      if (outgoing[i] === laneSha) {
        edges.push({
          from: i,
          to: i,
          color: incomingColors[i],
          kind: 'through',
        })
      }
    }

    // 2. Incoming branch lines: every lane that was waiting for this commit
    //    converges from the top edge down into the node.
    for (let i = 0; i < incoming.length; i++) {
      if (incoming[i] === sha) {
        edges.push({ from: i, to: node, color: incomingColors[i], kind: 'top' })
      }
    }

    // 3. Outgoing lines: from the node down to each parent's lane, using the
    //    exact column each parent was assigned above.
    for (const to of parentColumns.values()) {
      edges.push({ from: node, to, color: laneColors[to], kind: 'bottom' })
    }

    rows.set(sha, { node, color, edges, isMerge })

    laneCount = Math.max(
      laneCount,
      node + 1,
      usedWidth(incoming),
      usedWidth(outgoing)
    )
  }

  return { rows, laneCount }
}
