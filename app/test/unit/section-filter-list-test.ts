import { describe, it } from 'node:test'
import assert from 'node:assert'

import { SectionFilterList } from '../../src/ui/lib/section-filter-list'

interface ITestItem {
  readonly id: string
  readonly text: ReadonlyArray<string>
}

describe('SectionFilterList', () => {
  it('skips empty groups by default', () => {
    const list = createList()

    assert.equal(list.state.rows.length, 0)
  })

  it('keeps opted-in empty groups visible as header-only sections', () => {
    const list = createList(identifier => identifier === 'folder')

    assert.equal(list.state.rows.length, 1)
    assert.equal(list.state.rows[0].length, 1)
    assert.equal(list.state.rows[0][0].kind, 'group')
    assert.equal(list.state.groups[0], 0)
  })
})

function createList(
  shouldKeepGroupWhenEmpty?: (identifier: string) => boolean
) {
  return new SectionFilterList<ITestItem, string>({
    rowHeight: 29,
    groups: [{ identifier: 'folder', items: [] }],
    selectedItem: null,
    renderItem: () => null,
    renderGroupHeader: () => null,
    invalidationProps: {},
    shouldKeepGroupWhenEmpty,
  })
}
