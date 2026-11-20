// Security verification matrix for Sovereign X Firestore Rules
// Mirrors the 12 Dirty Dozen payloads defined in security_spec.md.

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  reason: string;
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on User Create',
    collection: 'users/{userId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'keys().hasOnly() rejects undeclared shadow keys such as isAdmin.',
  },
  {
    id: 2,
    name: 'PII Read by Non-Owner',
    collection: 'users/{userId}/private/info',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'Strict owner or verified admin gate blocks non-owner PII access.',
  },
  {
    id: 3,
    name: 'Unverified Email Write',
    collection: 'posts/{postId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isVerifiedUser() requires request.auth.token.email_verified == true.',
  },
  {
    id: 4,
    name: 'Author Spoofing on Post Create',
    collection: 'posts/{postId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidPost() enforces incoming().authorId == request.auth.uid.',
  },
  {
    id: 5,
    name: 'Non-Admin Item Shop Publish',
    collection: 'shopItems/{itemId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Only verified admin can write shopItems.',
  },
  {
    id: 6,
    name: 'Non-Admin Rigged Model Publish',
    collection: 'riggedModels/{modelId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Only verified admin can write riggedModels.',
  },
  {
    id: 7,
    name: 'Immutable Field Mutation',
    collection: 'posts/{postId}',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'Update actions restrict affectedKeys() and preserve authorId/createdAt.',
  },
  {
    id: 8,
    name: 'Type Poisoning on Update',
    collection: 'posts/{postId}',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidPost(incoming()) executes first on every update.',
  },
  {
    id: 9,
    name: 'Oversized Document ID Poisoning',
    collection: 'posts/{postId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidId(postId) enforces length <= 128 and strict regex.',
  },
  {
    id: 10,
    name: 'Orphaned Subcollection Comment',
    collection: 'posts/{postId}/comments/{commentId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Master Gate exists(/databases/.../posts/$(postId)) rejects orphan writes.',
  },
  {
    id: 11,
    name: 'Client Timestamp Forgery',
    collection: 'posts/{postId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'createdAt == request.time and updatedAt == request.time enforced.',
  },
  {
    id: 12,
    name: 'Unbounded Array Exhaustion',
    collection: 'users/{userId}/private/info',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'ownedItemIds.size() <= 100 enforced in isValidUserPrivate.',
  },
  {
    id: 13,
    name: 'Self-Unsuspend Account Attack',
    collection: 'users/{userId}',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'Non-admin affectedKeys() excludes accountStatus and adminNote.',
  },
  {
    id: 14,
    name: 'Forged Report Initial Status or Spoofed Reporter',
    collection: 'reports/{reportId}',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Report create mandates status == open and reporterId == request.auth.uid.',
  },
];
