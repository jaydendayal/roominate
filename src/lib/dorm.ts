/** Occupancy explicitly encoded by a common housing room-type label. */
export function occupancyFromRoomType(roomType: string | null) {
  const normalized = roomType?.toLowerCase() ?? "";
  if (/\b(single|one[- ]person)\b/.test(normalized)) return 1;
  if (/\b(double|two[- ]person)\b/.test(normalized)) return 2;
  if (/\b(triple|three[- ]person)\b/.test(normalized)) return 3;
  if (/\b(quad|four[- ]person)\b/.test(normalized)) return 4;
  return null;
}

/** Housing-provided furniture is supplied per resident unless the source lists more. */
export function quantityForOccupancy(quantity: number, roomType: string | null) {
  const occupancy = occupancyFromRoomType(roomType);
  return occupancy ? Math.max(quantity, occupancy) : quantity;
}
