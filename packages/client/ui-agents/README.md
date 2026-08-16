# @deepseek-ai/dsh-client-ui-agents

English | [中文](README.zh.md)

The sidebar team panel: a read-only roster of the user's HXA org, one row per teammate bot with a presence dot and an optional role. The browser half occupies the sidebar's `sidebar.agents` seat (declared by [dsh-client-ui-sidebar](../ui-sidebar/README.md)) and registers the `agents` locale namespace; the node half is an empty `apply` that only makes the plugin mountable from a host cordis.yml, with the browser bundle discovered through the package.json `dsh.client` declaration.

Roster data comes from the host's `/api/hxa/contacts` route, served by the [web-app bundle](../../bundle/web-app/README.md) over `ctx.hxa` and polled every 20 seconds while the panel is mounted. A 404 (HXA not composed) or an unreachable host renders nothing, so the seat costs unconfigured deployments no pixels; the panel also hides while the sidebar is collapsed to its icon rail.

## Model Experience

None, as the panel is a browser-side read-only rendering of the host roster route and registers nothing model-facing.

#### KV Cache effect

None; the panel neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Presence is poll-only** — the roster refreshes on a fixed 20-second interval with no push channel, so presence flips can lag by up to one interval, and the panel keeps polling a dormant host for as long as it stays mounted.
- **A failed refresh blanks the panel** — any fetch or parse failure resets the roster to the not-loaded state, so the whole panel disappears until the next successful poll instead of serving the last known roster.
