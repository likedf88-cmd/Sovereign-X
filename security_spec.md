# Security Specification (Sovereign X)

## Data Invariants
1. **Identity & PII Isolation**: `users/{userId}` holds only public profile/loyalty/avatar data (`email` is strictly isolated in `users/{userId}/private/info` readable only by `userId` or admin).
2. **No Self-Escalation of Admin or Loyalty Rank**: Users cannot create or mutate `admins/{uid}` documents, and cannot directly escalate `loyaltyRank` to `'Sovereign'` with forged `credits` beyond validated increments, or publish global `shopItems` / `riggedModels` without verified Admin privileges.
3. **Author Integrity**: Every `posts/{postId}`, `comments/{commentId}`, and `likes/{userId}` document must have `authorId == request.auth.uid` (or `uid == request.auth.uid`) on creation, and `authorId` and `createdAt` are immutable on update.
4. **Master Gate & Atomicity**: Subcollection writes (`posts/{postId}/likes/{userId}`, `posts/{postId}/comments/{commentId}`) verify the parent `posts/{postId}` exists. Likes enforce `getAfter` or `exists` parent checks.
5. **Temporal Integrity & Strict Keys**: Every `create` verifies `createdAt == request.time && updatedAt == request.time`; every `update` verifies `updatedAt == request.time`, `affectedKeys().hasOnly(...)`, and bounded string/array sizes.
6. **Path Variable Hardening**: Every single-document `get`, `create`, `update`, `delete` validates `isValidId(...)` (`^[a-zA-Z0-9_\\-]+$`, `<= 128` chars).
7. **Report & Account Moderation Isolation**: Users can only create `reports` with `reporterId == request.auth.uid` and initial `status == 'open'`, cannot read other users' reports, and cannot alter their own `accountStatus` or `adminNote` fields. Only verified Highest Admins can grant/revoke `/admins/{adminId}` or resolve moderation reports.

## Dirty Dozen Adversarial Payloads
1. **Shadow Field Injection on User Create**: `{ "uid": "u1", ..., "isAdmin": true }` -> PERMISSION_DENIED (blocked by `hasOnly`).
2. **PII Read by Non-Owner**: `get /users/victim/private/info` as `attacker` -> PERMISSION_DENIED.
3. **Unverified Email Write**: `create /posts/p1` with `request.auth.token.email_verified = false` -> PERMISSION_DENIED.
4. **Author Spoofing**: `create /posts/p1` with `authorId: "someone_else"` -> PERMISSION_DENIED.
5. **Non-Admin Item Shop Publish**: `create /shopItems/s1` by regular user -> PERMISSION_DENIED.
6. **Non-Admin Rigged Model Publish**: `create /riggedModels/m1` by regular user -> PERMISSION_DENIED.
7. **Immutable Field Mutation**: `update /posts/p1` changing `authorId` or `createdAt` -> PERMISSION_DENIED.
8. **Type Poisoning on Update**: `update /posts/p1` setting `likesCount: "hacked"` -> PERMISSION_DENIED (caught by `isValidPost`).
9. **Resource Exhaustion / Oversized ID**: `create /posts/<200-char-id>` -> PERMISSION_DENIED (caught by `isValidId`).
10. **Orphaned Comment**: `create /posts/nonexistent/comments/c1` -> PERMISSION_DENIED (Master Gate `exists` check).
11. **Timestamp Forgery**: `create /posts/p1` with client-supplied past `createdAt` instead of `request.time` -> PERMISSION_DENIED.
12. **Array Exhaustion**: `update /users/u1/private/info` with `ownedItemIds` length > 100 -> PERMISSION_DENIED.
13. **Self-Unsuspend Attack**: `update /users/u1` by `u1` setting `accountStatus: "active"` -> PERMISSION_DENIED.
14. **Forged Report Resolution**: `create /reports/r1` with `status: "resolved"` or `reporterId: "other"` -> PERMISSION_DENIED.

