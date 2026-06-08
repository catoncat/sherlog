# Why Sherlog? (Design Philosophy)

`Sherlog` searches your local Codex and Claude Code session history. It turns past conversations into instantly queryable runbooks. 

## Why not `ripgrep`?
`rg` dumps raw JSONL lines. Agents need conversational context, not unparsed strings. `Sherlog` understands the session structure: it finds the exact message, then provides primitives (`read-range`, `read-page`) for the agent to page through the surrounding dialogue cleanly.

## Why not Embedding / Vector Search?
**Because `Sherlog` is built for Agents.** Embeddings try to do semantic reasoning for humans, but an Agent is *already* a semantic reasoning engine. Chunking logs into a vector database destroys the causal timeline (Command -> Error -> Fix). `Sherlog` simply uses fast full-text search (FTS) to drop a bookmark, and lets the Agent use its own intelligence to read the surrounding timeline.

## Zero Documentation Tax
You don't need to stop and write clean notes. The raw history of how you and your agent solved a problem last time is directly searchable next time.

## A Composable Primitive
You don't have to use `Sherlog` end-to-end. It's a CLI that outputs standard JSON. Use it to locate the exact session, then pipe it to `jq`, read the raw file directly, or pass the context to other tools like Mainline. It's a retrieval engine, not a walled garden.
