export type PlatformMode = 'pc' | 'mobile' | 'console';
export type LoyaltyRank = 'Squire' | 'Sentinel' | 'Vanguard' | 'Sovereign';
export type AppSection = 'cover' | 'lounge' | 'media' | 'shop' | 'studio' | 'admin';
export type AvatarEmote = 'idle' | 'walk' | 'run' | 'wave' | 'dance' | 'hero' | 'jump' | 'combat';
export type AccountStatus = 'active' | 'warned' | 'suspended';

export interface UserProfile {
  uid: string;
  displayName: string;
  handle: string;
  photoURL?: string;
  loyaltyRank: LoyaltyRank;
  loyaltyXp: number;
  streakDays: number;
  credits: number;
  equippedAvatarId: string;
  equippedEmote: AvatarEmote;
  platform: PlatformMode;
  accountStatus?: AccountStatus;
  adminNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email?: string;
  ownedItemIds: string[];
  lastDailyClaimDay?: string;
  updatedAt?: unknown;
}

export type BoneControlShape = 'sphere' | 'ring' | 'cube' | 'diamond';

export interface BoneConstraint {
  enabled: boolean;
  minDeg: [number, number, number];
  maxDeg: [number, number, number];
  lockPosition?: boolean;
}

export interface BoneNode {
  name: string;
  parent: string | null;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  roll?: number;
  connected?: boolean;
  weightScale?: number;
  controlShape?: BoneControlShape;
  constraint?: BoneConstraint;
}

export type SkeletonPresetType = 'full-33' | 'ultra-45' | 'stylized-anime' | 'simple-15';
export type StudioWorkspaceMode = 'object' | 'edit' | 'pose' | 'weights' | 'ikfk' | 'animation';
export type ViewportShadingMode =
  | 'solid'
  | 'material'
  | 'wireframe'
  | 'xray'
  | 'skeleton'
  | 'weights'
  | 'unskinned';
export type TransformPivotMode = 'active' | 'median' | 'origin';
export type IKLimbId = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

export interface IKLimbState {
  id: IKLimbId;
  label: string;
  enabled: boolean;
  blend: number;
  rootBone: string;
  midBone: string;
  endBone: string;
  targetPos: [number, number, number];
  polePos: [number, number, number];
}

export interface ModelStats {
  vertices: number;
  triangles: number;
  meshes: number;
  materials: number;
  existingBones: number;
  animations: number;
  animationNames: string[];
  morphTargetCount: number;
  morphTargetNames: string[];
}

export interface SceneMeshInfo {
  name: string;
  uuid: string;
  vertices: number;
  triangles: number;
  visible: boolean;
  wireframe: boolean;
  materialName: string;
}

export interface VertexInfluenceEntry {
  boneIndex: number;
  boneName: string;
  weight: number;
}

export interface SelectedVertexInfo {
  meshUuid: string;
  meshName: string;
  vertexIndex: number;
  worldPos: [number, number, number];
  influences: VertexInfluenceEntry[];
}

export interface RigValidationIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  boneName?: string;
  meshName?: string;
  suggestion?: string;
  autoFixable: boolean;
}

export interface DeformationJointTestResult {
  jointRole: string;
  boneName: string;
  testAngleDeg: number;
  maxEdgeStretchRatio: number;
  displacementMag: number;
  passed: boolean;
  detail: string;
}

export interface RigAuditReport {
  overallPassed: boolean;
  passedChecks: string[];
  issues: RigValidationIssue[];
  problematicBones: string[];
  problematicMeshes: string[];
  deformationResults: DeformationJointTestResult[];
  testedAt?: string;
}

export interface AnimationBoneKey {
  rotation: [number, number, number]; // Euler radians
  position?: [number, number, number]; // Offset from rest position
}

export interface AnimationKeyframe {
  id: string;
  time: number; // seconds
  boneTransforms: Record<string, AnimationBoneKey>;
}

export interface FacialRigState {
  jawOpen: number;
  eyeLookX: number;
  eyeLookY: number;
  browTilt: number;
  leftFistCurl: number;
  rightFistCurl: number;
  fingerSpread: number;
  morphInfluences: Record<string, number>;
}

export interface RiggedModelConfig {
  id: string;
  name: string;
  creatorId: string;
  sourceType: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom';
  modelEndpoint?: string;
  bones: BoneNode[];
  weightConfig: {
    radius: number;
    falloff: number;
    symmetry: boolean;
  };
  defaultAnimation: AvatarEmote;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ShopCategory = 'avatar' | 'emote' | 'bundle' | 'aura';
export type ShopSection = 'featured' | 'daily' | 'royal-vault';
export type ShopRarity = 'mythic' | 'legendary' | 'epic' | 'rare' | 'uncommon';

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  category: ShopCategory;
  section: ShopSection;
  rarity: ShopRarity;
  price: number;
  imageUrl?: string;
  presetKey?: string;
  riggedModelId?: string;
  creatorId: string;
  creatorName: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PostKind = 'reel' | 'photo' | 'story';
export type VideoPlatform = 'youtube' | 'tiktok' | 'instagram' | 'direct' | 'native';

export interface SocialPost {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  kind: PostKind;
  caption: string;
  mediaUrl?: string;
  videoPlatform?: VideoPlatform;
  sourceUrl?: string;
  embedUrl?: string;
  presetScene?: string;
  avatarId?: string;
  emote?: AvatarEmote;
  likesCount: number;
  commentsCount: number;
  repostsCount?: number;
  sharesCount?: number;
  repostedFromPostId?: string;
  repostedFromAuthor?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt?: unknown;
}

export type ReportTargetType = 'post' | 'comment' | 'lounge-message' | 'user';
export type ReportReason = 'harassment' | 'spam' | 'inappropriate' | 'impersonation' | 'other';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface ContentReport {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetAuthorId?: string;
  targetAuthorName: string;
  targetExcerpt: string;
  reason: ReportReason;
  details?: string;
  reporterId: string;
  reporterName: string;
  status: ReportStatus;
  adminNotes?: string;
  resolvedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AdminRecord {
  uid: string;
  email: string;
  displayName: string;
  grantedBy: string;
  createdAt?: unknown;
}

export interface LoungeMember {
  clientId: string;
  uid: string;
  displayName: string;
  handle: string;
  platform: PlatformMode;
  loyaltyRank: LoyaltyRank;
  equippedAvatarId: string;
  emote: AvatarEmote;
  moveState?: 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'land' | 'turn';
  speed?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  chatText?: string;
  chatExpiresAt?: number;
  updatedAt: number;
}

export interface LoungeChatMessage {
  id: string;
  clientId: string;
  uid?: string;
  displayName: string;
  platform: PlatformMode;
  loyaltyRank: LoyaltyRank;
  text: string;
  timestamp: number;
}

export interface VaultShowcaseConfig {
  kicker: string;
  title: string;
  description: string;
  previewAvatarId: string;
  imageUrl?: string;
  updatedAt?: unknown;
}

export interface MeshIssueAnalysis {
  totalVertices: number;
  totalTriangles: number;
  nonManifoldEdges: number;
  boundaryEdges: number;
  degenerateTriangles: number;
  nanVertices: number;
  affectedMeshes: string[];
  hasIssues: boolean;
}

export interface ScanCorrectionReport {
  scannedAt: string;
  orientationFixed: boolean;
  orientationNote: string;
  jointsAdjusted: number;
  hierarchyFixed: boolean;
  rebuiltFullRig: boolean;
  weightsRebound: boolean;
  deformationPassed: boolean;
  missingRolesDetected: string[];
  rescaledToBase: boolean;
  meshIssues: MeshIssueAnalysis;
  fixesApplied: string[];
  bones: BoneNode[];
  auditReport: RigAuditReport;
}

