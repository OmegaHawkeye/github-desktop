import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Commit } from '../../src/models/commit'
import { CommitIdentity } from '../../src/models/commit-identity'
import { buildCommitGraph, ICommitGraphEdge } from '../../src/lib/commit-graph'

function makeCommit(sha: string, parentSHAs: ReadonlyArray<string>): Commit {
  const author = new CommitIdentity('A', 'a@example.com', new Date(0))
  return new Commit(
    sha,
    sha.slice(0, 7),
    sha,
    '',
    author,
    author,
    parentSHAs,
    [],
    []
  )
}

function graphOf(commits: ReadonlyArray<Commit>) {
  const lookup = new Map(commits.map(c => [c.sha, c]))
  return buildCommitGraph(
    commits.map(c => c.sha),
    lookup
  )
}

function hasEdge(
  edges: ReadonlyArray<ICommitGraphEdge>,
  from: number,
  to: number,
  kind: ICommitGraphEdge['kind']
): boolean {
  return edges.some(e => e.from === from && e.to === to && e.kind === kind)
}

describe('commit-graph', () => {
  describe('buildCommitGraph', () => {
    it('returns an empty graph for no commits', () => {
      const graph = buildCommitGraph([], new Map())
      assert.equal(graph.laneCount, 0)
      assert.equal(graph.rows.size, 0)
    })

    it('lays out a linear history in a single lane with a stable color', () => {
      // a -> b -> c (a is newest), c is the root.
      const commits = [
        makeCommit('a', ['b']),
        makeCommit('b', ['c']),
        makeCommit('c', []),
      ]

      const graph = graphOf(commits)

      assert.equal(graph.laneCount, 1)

      const a = graph.rows.get('a')!
      const b = graph.rows.get('b')!
      const c = graph.rows.get('c')!

      assert.equal(a.node, 0)
      assert.equal(b.node, 0)
      assert.equal(c.node, 0)

      // The first-parent chain keeps a single color.
      assert.equal(a.color, 0)
      assert.equal(b.color, 0)
      assert.equal(c.color, 0)

      assert.equal(a.isMerge, false)

      // a connects down to b, b connects down to c.
      assert.ok(hasEdge(a.edges, 0, 0, 'bottom'))
      assert.ok(hasEdge(b.edges, 0, 0, 'bottom'))
      // The root has no outgoing lane.
      assert.ok(!c.edges.some(e => e.kind === 'bottom'))
    })

    it('opens a second lane and marks the merge commit', () => {
      // m is a merge of a and b; both a and b are roots.
      const commits = [
        makeCommit('m', ['a', 'b']),
        makeCommit('a', []),
        makeCommit('b', []),
      ]

      const graph = graphOf(commits)

      assert.equal(graph.laneCount, 2)

      const m = graph.rows.get('m')!
      const a = graph.rows.get('a')!
      const b = graph.rows.get('b')!

      assert.equal(m.node, 0)
      assert.equal(m.isMerge, true)

      // The merge fans out to the first parent (same lane) and the second
      // parent (a freshly-opened lane 1).
      assert.ok(hasEdge(m.edges, 0, 0, 'bottom'))
      assert.ok(hasEdge(m.edges, 0, 1, 'bottom'))

      // The second parent's lane runs down the side past commit a.
      assert.equal(a.node, 0)
      assert.ok(hasEdge(a.edges, 1, 1, 'through'))

      // b is drawn in the side lane it was reserved for.
      assert.equal(b.node, 1)
    })

    it('converges branches back into a shared parent', () => {
      // Two children a and b of the same parent p; a is first.
      //   a -> p
      //   b -> p
      const commits = [
        makeCommit('a', ['p']),
        makeCommit('b', ['p']),
        makeCommit('p', []),
      ]

      const graph = graphOf(commits)

      const p = graph.rows.get('p')!

      // p is drawn once; both reserving lanes converge into its node from the
      // top of the row.
      const incomingIntoNode = p.edges.filter(e => e.kind === 'top')
      assert.ok(incomingIntoNode.length >= 1)
      assert.ok(incomingIntoNode.every(e => e.to === p.node))
    })

    it('never draws a pass-through lane as a diagonal (no stray lines)', () => {
      // Two tips (a merge `m` and a branch tip `x`) both descend from a shared
      // ancestor `p`, so several lanes end up reserved for `p` at once. On the
      // rows between the fork and `p` those lanes must render as straight
      // vertical segments; a regression once drew them diagonally toward the
      // leftmost duplicate, producing lines attached to no commit.
      const commits = [
        makeCommit('m', ['p', 'q']),
        makeCommit('q', ['p']),
        makeCommit('x', ['p']),
        makeCommit('p', []),
      ]

      const graph = graphOf(commits)

      // Invariant: a pass-through segment stays in its own lane.
      for (const row of graph.rows.values()) {
        for (const edge of row.edges) {
          if (edge.kind === 'through') {
            assert.equal(
              edge.from,
              edge.to,
              'through edges must be vertical (from === to)'
            )
          }
        }
      }

      // `x` sits above `p` with two lanes already reserved for `p`; both must
      // pass straight through its row.
      const x = graph.rows.get('x')!
      const throughs = x.edges.filter(e => e.kind === 'through')
      assert.ok(throughs.length >= 2)
      assert.ok(throughs.every(e => e.from === e.to))
    })

    it('gives independent roots their own colors while reusing lanes', () => {
      const commits = [makeCommit('a', []), makeCommit('b', [])]

      const graph = graphOf(commits)

      const a = graph.rows.get('a')!
      const b = graph.rows.get('b')!

      // The lane is reused, but the color advances so the two unrelated tips
      // are visually distinct.
      assert.equal(a.node, 0)
      assert.equal(b.node, 0)
      assert.notEqual(a.color, b.color)
    })
  })
})
