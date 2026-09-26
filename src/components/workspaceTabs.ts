import { BedDouble, Camera, DoorOpen, Grid2x2, Package, Pin, ShoppingBag, StickyNote, type LucideIcon } from "lucide-react";

export type Screen = "capture" | "studio" | "products" | "constraints" | "issues" | "better";

export interface WorkspaceTab {
  id: Screen;
  /** Shared by the sidebar, the homepage legend, and the callouts in the homepage model. */
  index: string;
  label: string;
  /** The object in the homepage model that opens this tab. */
  object: string;
  summary: string;
  icon: LucideIcon;
}

export const workspaceTabs: WorkspaceTab[] = [
  { id: "capture", index: "01", label: "Room capture", object: "Camera", summary: "Photos, guided scan, and confirmed measurements", icon: Camera },
  { id: "studio", index: "02", label: "3D Studio", object: "Window", summary: "Arrange furniture in the scaled room", icon: Grid2x2 },
  { id: "products", index: "03", label: "Products", object: "Boxes", summary: "Import, shop, and split the group cart", icon: Package },
  { id: "constraints", index: "04", label: "Constraints", object: "Corkboard", summary: "Budget, belongings, needs, and house rules", icon: Pin },
  { id: "issues", index: "05", label: "Issues", object: "Mirror notes", summary: "Fit, clearance, budget, and duplicate checks", icon: StickyNote },
  { id: "better", index: "06", label: "Better Cart", object: "Shopping bag", summary: "A tested cart that fixes what it can", icon: ShoppingBag },
];

/** The door in the homepage model opens the invite dialog rather than a tab. */
export const shareTarget = { label: "Share", object: "Door", summary: "Invite roommates to view or edit", icon: DoorOpen };

/** The bed in the homepage model leads to the index of every room plan in this browser. */
export const roomsTarget = { label: "Your rooms", object: "Bed", summary: "Switch to another room plan, or start a new one", icon: BedDouble };
