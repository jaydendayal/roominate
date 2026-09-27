import { describe, expect, it } from "vitest";
import { occupancyFromRoomType, quantityForOccupancy } from "./dorm";

describe("dorm room types", () => {
  it.each([
    ["Traditional double", 2],
    ["Two-person corner room", 2],
    ["TRIPLE suite", 3],
    ["Quad", 4],
    ["Apartment", null],
    [null, null],
  ])("maps %s to its explicit occupancy", (roomType, occupancy) => {
    expect(occupancyFromRoomType(roomType)).toBe(occupancy);
  });

  it("creates two of every provided furniture item for a double room", () => {
    expect(quantityForOccupancy(1, "Traditional double")).toBe(2);
    expect(quantityForOccupancy(1, "Triple suite")).toBe(3);
    expect(quantityForOccupancy(3, "Traditional double")).toBe(3);
  });
});
