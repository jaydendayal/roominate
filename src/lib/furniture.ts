export type FurnitureModelKind = "chair" | "couch" | "desk" | "wardrobe" | "hamper" | "beanbag" | "ottoman" | "dresser" | "lamp" | "mirror" | "mini_fridge" | "box";

export function furnitureModelKind(category: string, name = ""): FurnitureModelKind {
  const value = `${category} ${name}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/mini\s*fridge|compact refrigerator/.test(value)) return "mini_fridge";
  if (/laundry hamper|hamper|laundry basket/.test(value)) return "hamper";
  if (/bean\s*bag/.test(value)) return "beanbag";
  if (/wardrobe|armoire/.test(value)) return "wardrobe";
  if (/ottoman|footstool/.test(value)) return "ottoman";
  if (/dresser|chest of drawers/.test(value)) return "dresser";
  if (/couch|sofa|loveseat/.test(value)) return "couch";
  if (/chair/.test(value)) return "chair";
  if (/desk/.test(value)) return "desk";
  if (/floor lamp|table lamp|lamp|lighting/.test(value)) return "lamp";
  if (/mirror/.test(value)) return "mirror";
  return "box";
}
