# Herdmode Feature Ideas

## 1. Session Replay Timeline

JSONL files contain the full conversation tree with `parentUuid` chains, sidechains (`isSidechain`), tool calls, and thinking blocks. Render a visual timeline for each session — like a git graph but for the conversation. Show when the agent branched into sub-agents, when it got stuck in tool-approval loops, and where the token burn rate spiked. Lets you *see* what a session actually did without reading the chat.

## 2. Token Burn Rate Monitor (Real-time)

Cumulative `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens` per message. Compute a live token velocity (tokens/minute) and show it as a sparkline on each session card. Sudden spikes mean the agent is churning. A sustained high burn rate with no tool calls might mean it's stuck in a reasoning loop. Fire a notification: "midio is burning tokens 3x faster than its average."

## 3. Tool Approval Latency Tracker

The gap between a `tool_use` stop reason and the next `user` message (with `tool_result`) is how long the agent waited for permission. Mining this across sessions shows: which tools you approve fastest, which ones you hesitate on, and your average "human in the loop" latency. Over time this becomes a case for adjusting permission settings.

## 4. Session Categorization from Prompt Patterns

`history.jsonl` (600KB+, completely unused) contains every prompt typed. Classify sessions automatically: debugging, feature work, refactoring, exploration, review. Keyword heuristics on the first user message ("fix", "add", "refactor", "why does", "review"). Show it as a tag on each session card.

## 5. Plan-to-Session Linkage

700+ plan files in `~/.claude/plans/` are completely unused. Each has a date and topic. Cross-referencing plan timestamps with session start times shows "this session was working on Plan: redesign auth middleware" — connecting intention to execution.

## 6. Cache Hit Rate Dashboard

Every assistant message includes `cache_creation_input_tokens` and `cache_read_input_tokens`. The ratio tells you how effectively the agent is reusing context. Low cache hit rates mean the agent is re-reading files it already read. Actionable — tells you when a session is being wasteful and might benefit from a restart.

## 7. Cross-Session File Heatmap

`file-history/` has 15,000+ tracked file backups. Mining which files get modified across multiple sessions shows "hot files" — the ones that keep getting touched. These are either the core of your architecture or the source of recurring bugs.

## 8. "Ghost Sessions" — Predict What's Coming

`stats-cache.json` has hourly usage distribution data. Combined with current active sessions, predict: "Based on your patterns, you typically start 2 more sessions in the next hour." Ambient awareness that makes a monitoring tool feel alive.

## 9. Agent Depth Indicator

When `hasAgentTool` is true, the JSONL also shows tool inputs for the Agent tool — including the prompt given to the sub-agent. Show the agent nesting depth in real-time and what the sub-agent was tasked with. "Session is 3 agents deep, currently: running tests on auth module."

## 10. Session Cost Estimator

Token counts per model + known pricing = running dollar estimate per session and a daily total. Watching "$2.47 and counting" makes you think twice about letting a session spin.
