# Button order

GitHub Desktop uses a single, consistent button order across all platforms: the
dismissal (`Cancel`) button is always on the left and the affirmative/action
button (e.g. `Checkout`, `Delete Tag`) is always on the right. See
[OK-Cancel or Cancel-OK? The Trouble With Buttons](https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/)
for background on the historical platform differences.

Historically we mirrored the platform-specific conventions (affirmative on the
left on Windows, on the right on macOS), but this made the layout inconsistent
between platforms and harder to reason about. A fixed order — `Cancel` on the
left, the action on the right — keeps the placement predictable everywhere.

For more specific discussion of how our dialogs are implemented, please see the [dialogs documentation](https://github.com/desktop/desktop/blob/development/docs/technical/dialogs.md).

## Dangerous or destructive actions

Both Windows and macOS guidelines specifically call out the need for the default button to be the safest option when the action is dangerous or destructive. An example of such an action would be deleting a branch or removing a repository. In these cases, the default and initially selected button should never be the one that performs the destructive action. One exception we've made to this is when someone has explicitly tabbed to the button for a destructive action and then hits `Return` or `Enter`. In this case, we think the expectation of most people is that this will perform the destructive action, and therefore should select it to avoid confusion. We explained our reasoning for that in [this issue](https://github.com/desktop/desktop/issues/4187#issuecomment-552927923).
