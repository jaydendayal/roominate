import { describe, expect, it } from "vitest";
import { createDemoProject } from "./demo";
import { addDoorToRoom, moveDoorAlongPerimeter } from "./roomFeatures";

describe("3D room feature editing", () => {
  it("adds a door and matching keep-clear zone directly to the room", () => {
    const room = createDemoProject().room;
    const added = addDoorToRoom(room, "door-studio");
    const door = added.features.find((feature) => feature.id === "door-studio")!;
    const zone = added.clearanceZones.find((candidate) => candidate.id === "clear-door-studio")!;

    expect(door).toMatchObject({ name: "Door 2", kind: "door", wall: "south", confirmed: true });
    expect(door.position.y).toBeCloseTo(door.depth / 2);
    expect(zone.name).toBe("Door 2 swing");
    expect(zone.position.y).toBeCloseTo(zone.depth / 2);
  });

  it("moves a door to the nearest wall while keeping its full width on the perimeter", () => {
    const room = createDemoProject().room;
    const moved = moveDoorAlongPerimeter(room, "door-entry", { x: room.width, y: 0.1 });
    const door = moved.features.find((feature) => feature.id === "door-entry")!;

    expect(door.wall).toBe("east");
    expect(door.position.x).toBeCloseTo(room.width - door.depth / 2);
    expect(door.position.y).toBeCloseTo(door.width / 2);
    expect(door.confirmed).toBe(true);
    expect(door.source).toBe("user_confirmed");
    expect(moved.geometryVersion).toBe(room.geometryVersion + 1);
  });

  it("moves the door swing zone with the door", () => {
    const room = createDemoProject().room;
    const moved = moveDoorAlongPerimeter(room, "door-entry", { x: room.width, y: room.length / 2 });
    const zone = moved.clearanceZones.find((candidate) => candidate.id === "clear-door-entry")!;

    expect(zone.position.x).toBeCloseTo(room.width - zone.width / 2);
    expect(zone.position.y).toBeCloseTo(room.length / 2);
  });
});
