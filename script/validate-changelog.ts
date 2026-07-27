#!/usr/bin/env ts-node

import * as Path from 'path'
import * as Fs from 'fs'

import assert from 'assert'

interface Changelog {
  releases: Record<string, string[]>
}

function assertIsChangelog(obj: unknown): asserts obj is Changelog {
  assert(
    typeof obj === 'object' && obj !== null,
    'Expected changelog to be an object'
  )
  assert(
    Object.keys(obj).length === 1,
    'Expected changelog to have exactly one key'
  )
  assert('releases' in obj, 'Expected changelog to have a releases key')
  assert(
    typeof obj.releases === 'object' && obj.releases !== null,
    'Expected releases property to be an object'
  )
  const releases = Object.entries(obj.releases)
  assert(releases.length > 0, 'Expected at least one release')
  for (const [release, changes] of releases) {
    assert(
      /^([0-9]+.[0-9]+.[0-9]+)(-beta[0-9]+|-test[0-9]+)?$/.test(release),
      `Release ${release} does not match the expected format`
    )
    assert(
      Array.isArray(changes),
      `Expected changes for ${release} to be an array`
    )
    for (const change of changes) {
      assert(
        typeof change === 'string',
        `Expected all changes in ${release} to be strings`
      )
    }
  }
}

const repositoryRoot = Path.dirname(__dirname)
const changelogPath = Path.join(repositoryRoot, 'changelog.json')

// eslint-disable-next-line no-sync
const changelog = Fs.readFileSync(changelogPath, 'utf8')

let changelogObj: unknown

try {
  changelogObj = JSON.parse(changelog)
} catch {
  console.error(
    'Unable to parse the contents of changelog.json into a JSON object. Please review the file contents.'
  )
  process.exit(-1)
}

assertIsChangelog(changelogObj)

console.log('The changelog is totally fine')
