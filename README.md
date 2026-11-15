# agent-progress-board

A phone-friendly board of work progress across projects, fed by coding agents.

One group per project. Each item (a planned slice, a problem, something waiting for a person,
a bug, new unplanned work) is a colour-coded tile with one line of what and why, plus its
parent. The board shows everything still open plus whatever finished in the last 12 hours.
Everything is exposed through one remote MCP server: agents load it as an MCP server, or post
the same MCP tool calls over HTTPS where they can't. Clients live in the repos that use them.

Status: planning. See [plan.md](plan.md).

## Design in one paragraph

A Cloudflare Worker with a D1 database holds the items. State comes from two sources merged
on one stable key per item: a sync step that reads each repo's plan documents, and live
events pushed by agents and hooks. Item types, colours and the project list come from
configuration; the code holds no project data.

## License

MIT, see [LICENSE](LICENSE). Public but unsupported: issues may not get answers.
