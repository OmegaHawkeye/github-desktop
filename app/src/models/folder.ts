import { createEqualityHash } from './equality-hash'

/** A user-defined folder for organizing repositories in the sidebar. */
export class Folder {
  public readonly hash: string

  public constructor(
    public readonly id: number,
    public readonly name: string,
    public readonly sortOrder: number,
    /** Parent folder id, or `null` for a top-level folder. */
    public readonly parentFolderID: number | null = null,
    /** A CSS color (e.g. `#rrggbb`) for the folder, or `null` for the default. */
    public readonly color: string | null = null
  ) {
    this.hash = createEqualityHash(
      id,
      name,
      sortOrder,
      parentFolderID,
      color ?? ''
    )
  }
}
