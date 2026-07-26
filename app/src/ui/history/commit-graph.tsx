import * as React from 'react'
import { ICommitGraphRow } from '../../lib/commit-graph'

/** Horizontal distance between two adjacent lanes, in pixels. */
const LaneWidth = 14
/** Left padding before the first lane, in pixels. */
const LanePadding = 11
/** Right padding after the last lane, in pixels. */
const LaneTrailingPadding = 6
/** Radius of a regular commit node, in pixels. */
const NodeRadius = 4
/** Radius of a merge commit node (drawn slightly smaller/hollow), in pixels. */
const MergeNodeRadius = 3
/** Stroke width used for both lane lines and the node outline, in pixels. */
const StrokeWidth = 2

/** Map a lane index to the x coordinate of its center. */
function laneX(lane: number): number {
  return LanePadding + lane * LaneWidth
}

/**
 * The fixed pixel width of the graph column for a graph with the given number
 * of lanes. Kept constant across every row so the commit summaries stay
 * left-aligned regardless of how many lanes a particular row uses.
 */
export function getCommitGraphWidth(laneCount: number): number {
  if (laneCount <= 0) {
    return 0
  }
  return laneX(laneCount - 1) + LaneTrailingPadding
}

interface ICommitGraphProps {
  /** The pre-computed lane layout for this commit's row. */
  readonly row: ICommitGraphRow
  /** The height of the row in pixels (matches the list's row height). */
  readonly rowHeight: number
  /** The fixed width of the graph column in pixels (see getCommitGraphWidth). */
  readonly width: number
}

/**
 * Renders the SourceTree-style graph cell for a single commit row: the lane
 * lines weaving through the row plus the commit's node. Purely presentational —
 * all layout is computed up-front by `buildCommitGraph`.
 */
export class CommitGraph extends React.PureComponent<ICommitGraphProps> {
  private renderEdge(
    edge: ICommitGraphProps['row']['edges'][number],
    key: number
  ): JSX.Element {
    const { rowHeight } = this.props
    const mid = rowHeight / 2
    const x1 = laneX(edge.from)
    const x2 = laneX(edge.to)

    let y1: number
    let y2: number
    switch (edge.kind) {
      case 'through':
        y1 = 0
        y2 = rowHeight
        break
      case 'top':
        y1 = 0
        y2 = mid
        break
      case 'bottom':
        y1 = mid
        y2 = rowHeight
        break
      default:
        y1 = 0
        y2 = rowHeight
    }

    // A straight vertical line when the lane doesn't shift, otherwise a smooth
    // cubic curve between the two lanes so branches and merges flow nicely.
    const d =
      x1 === x2
        ? `M ${x1} ${y1} L ${x2} ${y2}`
        : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${
            (y1 + y2) / 2
          }, ${x2} ${y2}`

    return (
      <path
        key={key}
        className="commit-graph-edge"
        d={d}
        fill="none"
        stroke={`var(--commit-graph-color-${edge.color})`}
        strokeWidth={StrokeWidth}
        strokeLinecap="round"
      />
    )
  }

  public render() {
    const { row, rowHeight, width } = this.props
    const nodeX = laneX(row.node)
    const nodeColor = `var(--commit-graph-color-${row.color})`

    return (
      <svg
        className="commit-graph"
        width={width}
        height={rowHeight}
        viewBox={`0 0 ${width} ${rowHeight}`}
        aria-hidden="true"
      >
        {row.edges.map((edge, i) => this.renderEdge(edge, i))}
        <circle
          className="commit-graph-node"
          cx={nodeX}
          cy={rowHeight / 2}
          r={row.isMerge ? MergeNodeRadius : NodeRadius}
          fill={row.isMerge ? 'var(--background-color)' : nodeColor}
          stroke={nodeColor}
          strokeWidth={StrokeWidth}
        />
      </svg>
    )
  }
}
