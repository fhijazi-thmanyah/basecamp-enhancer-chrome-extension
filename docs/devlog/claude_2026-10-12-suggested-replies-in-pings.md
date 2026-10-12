# Suggested replies now show in pings and campfires (v1.24.2)

Faris: suggested replies show on threads but not in DMs (sidebar ping or full-page ping).

## Root cause
Matching was fine. The card was rendered, but appended into `.chat__lines`, which in
Basecamp chats is a `column-reverse` `<bc-infinite-page>` scroller. An appended child
renders at the TOP of the loaded history, not the bottom. Measured live with the real
installed v1.24.1 in a sidebar ping (محمد العجاجي, 48437449): card present, `top=-3557px`.
Campfires use the same component, so they had the same bug.

## Fix
`applyRunway` puts chat drafts in a `.bce-rw-slot--chat` inside the pane's
`.chat__footer`, right before `.chat__container` (the composer). Capped at 45vh with
its own scroll so a long draft never pushes a sidebar composer off-screen.

## Verified
- `scripts/runway-harness.sh`: mock pane rebuilt to the real shape (grid room,
  column-reverse lines, footer > chat__container); new asserts (above composer, not in
  lines, visible between lines and composer). Fails on v1.24.1, passes now.
- Live in Faris's Chrome (thmanyah profile): full-page ping يزيد الجهني (48990719) and a
  sidebar ping, by injecting the new placement against the real DOM: card visible
  directly above the composer. Campfire DOM checked: identical structure.
- Not done: reloading the installed unpacked extension (needs chrome://extensions).

Testing gotcha: an MCP tab in a background window has `document.hidden = true`, and
`rwPoll` skips hidden tabs, so the real extension renders nothing there. Not a bug.
