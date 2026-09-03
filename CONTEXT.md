# Omni Studio Collaboration

Omni Studio organizes AI media production inside isolated team spaces. This vocabulary defines identity, ownership, production hierarchy, and collaborative editing.

## Language

**User**:
An authenticated person who can belong to one or more Workspaces.
_Avoid_: Account owner, operator

**Workspace**:
The isolation boundary for members, Projects, shared assets, media, and provider settings.
_Avoid_: Tenant, organization

**Owner**:
The single Workspace membership role that can manage members, top-level Projects, shared assets, and provider settings.
_Avoid_: Admin user, global owner

**Member**:
A Workspace membership role that can edit content inside existing Projects and use or fork shared assets.
_Avoid_: User role, collaborator role

**Project**:
A top-level production container in a Workspace; it is either standalone or series-based.
_Avoid_: Script, episode

**Episode**:
The independently editable production unit inside a Project. A standalone Project contains one same-ID Episode.
_Avoid_: Project, document

**Script**:
The versioned production payload owned one-to-one by an Episode.
_Avoid_: Project, raw text

**Edit Lease**:
A short-lived single-writer claim on one Episode's Script, renewed by heartbeat and released on exit or expiry.
_Avoid_: Session lock, permanent lock

**Revision**:
The SHA-256 identity of the persisted Script payload used for compare-and-swap saves.
_Avoid_: Version number, timestamp
