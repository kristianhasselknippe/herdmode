# Session Permissions: View & Edit

**Date:** 2026-03-31

## Overview

Add a permissions card to the session detail panel that shows the effective (merged) permissions for a session across all three Claude Code settings layers, with inline editing to add/remove rules.

## Data Model

```typescript
type PermissionLayer = "global" | "global-local" | "project";

interface PermissionRule {
  pattern: string;        // e.g. "Bash(git:*)", "Read(//tmp/**)"
  type: "allow" | "deny";
  layer: PermissionLayer;
}

interface SessionPermissions {
  permissionMode: string;           // "default", "plan", "autoaccept", etc.
  rules: PermissionRule[];          // merged from all layers, tagged by source
}
```

`Session` gains a new field: `permissions?: SessionPermissions`.

## Permission Layers

Three settings files are read and merged:

| Layer | File Path | Scope |
|-------|-----------|-------|
| `global` | `~/.claude/settings.json` | All sessions |
| `global-local` | `~/.claude/settings.local.json` | All sessions (machine-local overrides) |
| `project` | `<cwd>/.claude/settings.local.json` | Sessions in that project directory |

Each file has the structure:
```json
{
  "permissions": {
    "allow": ["Pattern1", "Pattern2"],
    "deny": ["Pattern3"]
  }
}
```

Rules are merged into a flat list. Each rule is tagged with its source layer for display and edit routing.

The `permissionMode` (e.g., "default", "plan", "autoaccept") is extracted from the last user message in the session's JSONL conversation log. Defaults to `"default"` if not found.

## Server Changes

### New file: `packages/server/src/permissions.ts`

**`readPermissions(cwd: string, permissionMode: string): SessionPermissions`**
- Reads all three settings files (global, global-local, project)
- Merges `permissions.allow` and `permissions.deny` arrays from each into a flat `PermissionRule[]` list, tagging each with its layer
- Returns `{ permissionMode, rules }`
- Gracefully handles missing files (skips them)

**`updatePermissionRule(cwd: string, layer: PermissionLayer, type: "allow" | "deny", pattern: string, action: "add" | "remove"): void`**
- Resolves the correct file path based on layer:
  - `"global"` -> `~/.claude/settings.json`
  - `"global-local"` -> `~/.claude/settings.local.json`
  - `"project"` -> `<cwd>/.claude/settings.local.json`
- Reads the file (or starts with `{}` if it doesn't exist)
- Adds or removes the pattern from `permissions.allow` or `permissions.deny`
- Writes the file back with the same JSON formatting

### Changes to `packages/server/src/sessions.ts`

- Import and call `readPermissions(session.cwd, permissionMode)` during session enrichment
- `permissionMode` is extracted from the last user message's `permissionMode` field in the JSONL (this field is already adjacent to existing JSONL parsing logic)
- Attach result to session as `permissions` field

### New API routes in `packages/server/src/app.ts`

- **`GET /api/sessions/:sessionId/permissions`** — Returns merged permissions for a session
- **`POST /api/sessions/:sessionId/permissions`** — Body: `{ layer: PermissionLayer, type: "allow" | "deny", pattern: string, action: "add" | "remove" }` — Modifies the appropriate settings file

### Real-time updates

The existing file watcher on `~/.claude/` already detects settings file changes. When a settings file is modified via the API, the watcher triggers a WebSocket broadcast with updated session data (including the new permissions field). No additional watcher setup is needed.

For project-level settings files (`<cwd>/.claude/settings.local.json`), these are outside the watched directory. The permissions will refresh on the next polling cycle (2s) or can be re-read on the next WebSocket broadcast triggered by any session activity.

## Frontend Changes

### New component: `packages/web/src/components/Permissions.tsx`

A card placed in the right column of `SessionDetail`, between Task Progress and Integrations.

**Card header:**
- Title: "PERMISSIONS"
- Badge showing `permissionMode` (e.g., `DEFAULT`, `PLAN`)

**Rule list:**
- Each row displays:
  - Colored type tag: green "ALLOW" or red "DENY"
  - Muted layer label: `global`, `local`, or `project`
  - Pattern in monospace text
  - "x" remove button (calls POST endpoint with `action: "remove"`)
- Rules sorted: deny first, then allow, alphabetically within each group
- Empty state: "No permission rules configured"

**Add rule row (at bottom):**
- Toggle for allow/deny
- Dropdown for layer selection (global / global-local / project)
- Text input for pattern
- "Add" button

**Data flow:**
- Permissions arrive as part of the `Session` object via WebSocket — no separate fetch
- Add/remove calls `POST /api/sessions/:sessionId/permissions`
- File watcher detects the change and broadcasts updated session data

### Changes to `packages/web/src/components/SessionDetail.tsx`

- Import and render `<Permissions session={session} />` in the right column

### CSS additions in `packages/web/src/App.css`

Minimal new styles:
- `.permission-rule` — flex row for each rule
- `.permission-type-tag` — colored badge for allow/deny
- `.permission-layer-label` — muted text for source layer
- `.permission-pattern` — monospace pattern text
- `.permission-remove-btn` — small "x" button
- `.permission-add-row` — flex row for the add controls
- `.permission-mode-badge` — badge in card header

Reuses existing `.detail-card`, `.detail-card-header` patterns.

## Type Changes

Both `packages/server/src/types.ts` and `packages/web/src/types.ts` gain:
- `PermissionLayer` type
- `PermissionRule` interface
- `SessionPermissions` interface
- `permissions?: SessionPermissions` on `Session`

## Files Modified

| File | Change |
|------|--------|
| `packages/server/src/types.ts` | Add permission types, update Session |
| `packages/web/src/types.ts` | Mirror permission types, update Session |
| `packages/server/src/permissions.ts` | **New** — read/write permission settings |
| `packages/server/src/sessions.ts` | Call readPermissions during enrichment |
| `packages/server/src/app.ts` | Add GET/POST permission routes |
| `packages/web/src/components/Permissions.tsx` | **New** — permissions card component |
| `packages/web/src/components/SessionDetail.tsx` | Import and render Permissions card |
| `packages/web/src/App.css` | Permission card styles |
