import { createEqualityHash } from './equality-hash'

/** A user-defined folder for organizing repositories in the sidebar. */
export class Folder {
  public readonly hash: string

  public constructor(
    public readonly id: number,
    public readonly name: string,
    public readonly sortOrder: number
  ) {
    this.hash = createEqualityHash(id, name, sortOrder)
  }
}
