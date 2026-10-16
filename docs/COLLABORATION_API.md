# Collaboration: what the server needs

The studio has a **Team** page (sidebar) and a **Share** panel inside each agent. Together they let a workspace owner give each person a **role** and a **scope**:

- **Role**: what the person may do. `owner`, `admin`, `editor`, `viewer` (see the table).
- **Scope**: where they may do it. Either the **whole workspace** (every agent, including agents made later) or **only some agents** (a list of agent ids).

Today this is a **preview**: the team is kept in the browser (`localStorage`, key `weave_team_<workspace id>`), no email is sent, and nothing limits anyone, because the server has no idea who is calling (the studio talks to it with one shared key). This page says what the server must offer so the studio can drop the preview and the access can be enforced. The rules the studio uses are in `src/studio/team/teamModel.js` and are covered by `tests/team.test.js`; the server should apply the same ones.

## Roles

| Role     | See | Try | Change | Publish and deploy | Manage people | Scope                             |
| -------- | --- | --- | ------ | ------------------ | ------------- | --------------------------------- |
| `owner`  | yes | yes | yes    | yes                | yes           | whole workspace only; exactly one |
| `admin`  | yes | yes | yes    | yes                | yes           | whole workspace only              |
| `editor` | yes | yes | yes    | yes                | no            | whole workspace or some agents    |
| `viewer` | yes | yes | no     | no                 | no            | whole workspace or some agents    |

"Try" means a test conversation, a replay and reading calls; it never changes the agent.

## What the studio needs

1. **Who is calling.** A way for the studio to sign a person in (a token per person, not one shared key), and `GET /me` → `{ id, email, name, workspaces: [{ id, role, scope }] }`.
2. **The team of a workspace.**
   - `GET /workspaces/{ws}/members` → `[{ id, email, name, role, scope, status: "active" | "invited", invited_by, created_at }]`, where `scope` is `{ "all": true }` or `{ "agents": ["acme-support", "billing"] }`.
   - `POST /workspaces/{ws}/members` with `{ emails: [...], role, scope }` → creates one invitation per address and sends the email. Answers `409` for an address already on the team and `422` for a scope that is empty for a role that needs one.
   - `PATCH /workspaces/{ws}/members/{id}` with `{ role?, scope? }`, and `DELETE /workspaces/{ws}/members/{id}`.
   - Refused with `409`: changing or removing the owner, and any change that leaves no active person able to manage people.
3. **Who can open one agent** (what the Share panel shows): `GET /bots/{id}/access` → `[{ member_id, email, name, role, via: "workspace" | "agent" }]`, and `PUT /bots/{id}/access/{member_id}` / `DELETE` to share or stop sharing just that agent. These are shortcuts over the member's `scope`; when an agent is deleted its id is removed from every scope, and a person who had only that agent leaves the team.
4. **Enforcement.** Every existing endpoint checks the caller's role for the agent in the path: `GET /bots` lists only the agents the caller can open, reads need `see`, `POST …/test`, previews and runs need `try`, `PUT` on the draft needs `change`, publishing and deploying need `publish`, and `403` with `{ "needs": "change" }` otherwise. Workspace-wide lists (calls, monitoring) are limited to the same agents.
5. **Invitations.** `GET /invitations/{token}` and `POST /invitations/{token}/accept`, so an invited person can join.
6. **Audit.** Who invited, changed or removed whom, and when (`GET /workspaces/{ws}/audit`), so an owner can see it.

## What changes in the studio when it exists

- `src/studio/team/useTeam.js` reads and writes the endpoints above instead of `localStorage`; the Team page and the Share panel do not change.
- The "Preview" notice goes away, and an invitation says an email was sent.
- Buttons the caller's role does not allow (Save, Publish, Deploy for a viewer) are disabled with the reason, using `canDo` in `teamModel.js`.
