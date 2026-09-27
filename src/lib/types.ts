export type EvidenceSource =
  | "user_confirmed"
  | "media_estimate"
  | "scan"
  | "imported_plan"
  | "url"
  | "screenshot"
  | "retailer_api"
  | "demo_fixture";

export type Confidence = "confirmed" | "likely" | "uncertain";

/** A point on the floor plane. X is room width, Y is room length; Z is vertical in 3D. */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number | null;
  depth: number | null;
  height: number | null;
}

export interface FurnitureVisualPart {
  primitive: "box" | "cylinder" | "sphere" | "cone";
  role: "body" | "top" | "seat" | "back" | "arm" | "leg" | "base" | "door" | "drawer" | "shelf" | "cushion" | "shade" | "handle" | "other";
  /** Normalized center within the collision box: X width, Y vertical, Z depth. */
  position: { x: number; y: number; z: number };
  /** Fractions of the confirmed width, height, and depth respectively. */
  size: { x: number; y: number; z: number };
  /** Euler rotation in degrees around the part's local X/Y/Z axes. */
  rotation: { x: number; y: number; z: number };
  material: "wood" | "fabric" | "metal" | "plastic" | "glass" | "mixed";
  colorHex: string | null;
}

export interface FurnitureVisualProfile {
  archetype: "chair" | "couch" | "desk" | "wardrobe" | "hamper" | "beanbag" | "ottoman" | "dresser" | "lamp" | "mirror" | "mini_fridge" | "box";
  style: "modern" | "traditional" | "industrial" | "minimal" | "soft" | "utility";
  material: "wood" | "fabric" | "metal" | "plastic" | "glass" | "mixed";
  silhouette: "slim" | "standard" | "rounded" | "bulky";
  hasArms: boolean;
  hasBack: boolean;
  legStyle: "four_leg" | "pedestal" | "sled" | "solid" | "none";
  colorHex: string | null;
  confidence: number;
  evidence: string;
  /** Optional image- or description-derived primitives; older saved profiles fall back to their archetype. */
  parts?: FurnitureVisualPart[];
}

export interface Evidence {
  source: EvidenceSource;
  confidence: number;
  confirmedByUser: boolean;
  note?: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: "image" | "video";
  dataUrl?: string;
  privacy: "private" | "shared";
  size: number;
}

export interface RoomFeature {
  id: string;
  name: string;
  kind: "door" | "window" | "closet" | "radiator" | "obstacle";
  position: Vec2;
  width: number;
  depth: number;
  height: number;
  elevation?: number;
  wall?: "north" | "south" | "east" | "west" | "interior" | "unknown";
  source?: EvidenceSource;
  confidence?: number;
  evidence?: string;
  confirmed: boolean;
}

export interface ClearanceZone {
  id: string;
  name: string;
  position: Vec2;
  width: number;
  depth: number;
  source: EvidenceSource;
  confirmed: boolean;
}

export interface PaletteSwatch {
  id: string;
  hex: string;
  label: string;
  source: string;
  pinned: boolean;
}

export type BedSize = "twin" | "twin_xl" | "full" | "full_xl" | "queen" | "king" | "california_king";

export interface Room {
  id: string;
  /** Overall width (X) and length (Y): the bounding box of the floor when it has a traced outline. */
  width: number;
  length: number;
  height: number;
  /**
   * Floor outline traced from a plan, counter-clockwise, as fractions of `width` (x) and `length` (y),
   * so editing either dimension stretches the shape. Omitted means a plain width × length rectangle.
   */
  outline?: Vec2[];
  /**
   * Size of the first bed that comes with the room ("none" if it has none); the beds themselves are
   * owned items. Omitted in rooms saved before this setting; they default to one Twin XL.
   */
  providedBed?: BedSize | "none";
  dimensionEvidence: Record<"width" | "length" | "height", Evidence>;
  mediaAssets: MediaAsset[];
  features: RoomFeature[];
  clearanceZones: ClearanceZone[];
  geometryVersion: number;
  reconstructionStatus: "manual" | "estimated" | "reviewed";
  palette: PaletteSwatch[];
}

export interface Money {
  amount: number;
  currency: "USD";
  observedAt: string;
  confirmed: boolean;
}

export interface Product {
  id: string;
  name: string;
  store: string;
  sourceURL: string | null;
  screenshotDataUrl?: string;
  imageURL?: string;
  retailer?: "amazon" | "ikea" | "other";
  externalId?: string;
  visualProfile?: FurnitureVisualProfile;
  category: string;
  variant: string;
  dimensions: Dimensions;
  price: Money | null;
  fieldEvidence: Record<string, Evidence>;
  alternativeGroupId?: string;
  tags: string[];
}

export type AcquisitionStatus = "owned" | "planned" | "tentative" | "buying";

export interface Item {
  id: string;
  productId: string;
  ownerId: string;
  acquisitionStatus: AcquisitionStatus;
  purchaseStatus: "in_cart" | "not_purchasing" | "deferred";
  quantity: number;
  essentiality: "essential" | "optional";
  needsServed: string[];
  /** `elevation` is the item's base height on the vertical Z axis; omitted means 0 (on the floor). */
  transform: { position: Vec2; rotationZ: number; elevation?: number } | null;
  placementType: "floor" | "wall" | "stacked";
  locked?: boolean;
  /** Chosen finish per color group ("color", or "cover"/"frame"): a retailer option name or a custom "#rrggbb". Omitted means the listed color. */
  colorSelection?: Record<string, string>;
}

export interface Person {
  id: string;
  name: string;
  /** Kept for saved projects and the invite API; the UI colours people with `personTone` instead. */
  color: string;
}

export interface HousingRule {
  id: string;
  label: string;
  text: string;
  sourceURL: string | null;
  sourceType: "user_note" | "official";
  verificationStatus: "confirmed" | "needs_review";
  prohibitedCategories: string[];
  prohibitedTags: string[];
  dismissed: boolean;
}

export type IssueType =
  | "fit"
  | "clearance"
  | "budget"
  | "duplicate"
  | "rule"
  | "missing_data"
  | "unmet_need";

export interface Issue {
  id: string;
  type: IssueType;
  severity: "error" | "warning" | "info";
  confidence: Confidence;
  affectedItemIds: string[];
  affectedGeometryIds: string[];
  message: string;
  detail: string;
  suggestedActions: string[];
  status: "open" | "resolved" | "dismissed";
}

export type DuplicateResolution =
  | { action: "intentional"; note: string }
  | { action: "keep"; keepItemId: string }
  | { action: "coordinate"; buyerId: string };

export interface ProposalChange {
  id: string;
  type: "replace" | "remove" | "reposition" | "defer";
  itemId: string;
  replacementProductId?: string;
  position?: Vec2;
  rotationZ?: number;
  /** Deterministic reason generated by code; never overwritten by AI output. */
  reason: string;
  impact: string;
  /** Optional AI-written rephrasing of reason + impact, shown alongside (not instead of) the deterministic text. */
  explanation?: string;
  confidence: Confidence;
  accepted: boolean | null;
}

export interface Proposal {
  id: string;
  basedOnGeometryVersion: number;
  basedOnCartVersion: number;
  beforeSubtotal: number;
  afterSubtotal: number;
  changes: ProposalChange[];
  resolvedIssueIds: string[];
  remainingIssueIds: string[];
  /** Problems no automatic change could solve, with what the group could change, measure, or decide. */
  blockers?: string[];
  createdAt: string;
  stale: boolean;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  roomType: string;
  ownerId: string;
  people: Person[];
  room: Room;
  products: Product[];
  items: Item[];
  budgetAmount: number;
  budgetCurrency: "USD";
  /** Priority ids (see priorities.ts), most important first. Older rooms may hold free-text labels. */
  priorities: string[];
  /** Required functions (need ids from needs.ts) that Better Cart keeps covered. */
  needs: string[];
  rules: HousingRule[];
  duplicateResolutions: Record<string, DuplicateResolution>;
  proposal: Proposal | null;
  cartVersion: number;
  createdAt: string;
  updatedAt: string;
  collaboration?: {
    token: string;
    participantId: string;
    permission: "view" | "edit";
    revision: number;
    expiresAt: string;
  };
}
