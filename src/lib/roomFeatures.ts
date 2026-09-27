import { closestPointOnSegment, FEATURE_DEFAULTS, roomPolygon, wallSegments } from "./roomShape";
import type { ClearanceZone, Room, RoomFeature, Vec2 } from "./types";

const studioEvidence = "Positioned along the room perimeter in the 3D Studio";

/** Adds a standard door and its keep-clear swing zone, initially centered on the nearest usable wall. */
export function addDoorToRoom(room: Room, id = `door-${crypto.randomUUID()}`): Room {
  const defaults = FEATURE_DEFAULTS.door;
  const number = room.features.filter((feature) => feature.kind === "door").length + 1;
  const name = number === 1 ? "Entry door" : `Door ${number}`;
  const target = { x: room.width / 2, y: 0 };
  const door: RoomFeature = {
    id,
    name,
    kind: "door",
    position: target,
    width: defaults.width,
    depth: defaults.depth,
    height: defaults.height,
    elevation: defaults.elevation,
    source: "user_confirmed",
    confidence: 1,
    evidence: studioEvidence,
    confirmed: true,
  };
  const zone: ClearanceZone = {
    id: `clear-${id}`,
    name: `${name} swing`,
    position: target,
    width: defaults.width,
    depth: defaults.width,
    source: "user_confirmed",
    confirmed: true,
  };
  return moveDoorAlongPerimeter({
    ...room,
    features: [...room.features, door],
    clearanceZones: [...room.clearanceZones, zone],
  }, id, target);
}

function attachedDoorZone(room: Room, door: RoomFeature): ClearanceZone | null {
  const featureId = door.id.toLowerCase();
  const featureName = door.name.toLowerCase();
  const named = room.clearanceZones.find((zone) => {
    const id = zone.id.toLowerCase();
    const name = zone.name.toLowerCase();
    return id.includes(featureId) || name.includes(featureName);
  });
  if (named) return named;

  const doors = room.features.filter((feature) => feature.kind === "door");
  const doorZones = room.clearanceZones.filter((zone) => /door|entry|swing/.test(`${zone.id} ${zone.name}`.toLowerCase()));
  return doors.length === 1 && doorZones.length === 1 ? doorZones[0] : null;
}

/**
 * Moves a door to the nearest usable wall segment. Its full width stays on that segment, its depth
 * remains just inside the wall, and an associated swing/keep-clear zone follows it into the room.
 */
export function moveDoorAlongPerimeter(room: Room, featureId: string, target: Vec2): Room {
  const door = room.features.find((feature) => feature.id === featureId && feature.kind === "door");
  if (!door) return room;

  const allSegments = wallSegments(roomPolygon(room));
  const usable = allSegments.filter((segment) => segment.length + 1e-6 >= door.width);
  const segments = usable.length ? usable : allSegments;
  const hit = segments
    .map((segment) => ({ segment, ...closestPointOnSegment(target, segment.start, segment.end) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (!hit) return room;

  const { segment } = hit;
  const halfWidth = Math.min(door.width / 2, segment.length / 2);
  const along = Math.max(halfWidth, Math.min(segment.length - halfWidth, hit.t * segment.length));
  const direction = { x: (segment.end.x - segment.start.x) / segment.length, y: (segment.end.y - segment.start.y) / segment.length };
  const wallPoint = { x: segment.start.x + direction.x * along, y: segment.start.y + direction.y * along };
  const inside = (distance: number) => ({
    x: wallPoint.x - segment.normal.x * distance,
    y: wallPoint.y - segment.normal.y * distance,
  });
  const movedDoor: RoomFeature = {
    ...door,
    position: inside(door.depth / 2),
    wall: segment.facing,
    source: "user_confirmed",
    confidence: 1,
    evidence: studioEvidence,
    confirmed: true,
  };

  const zone = attachedDoorZone(room, door);
  const clearanceZones = zone ? room.clearanceZones.map((candidate) => {
    if (candidate.id !== zone.id) return candidate;
    // Clearance zones are axis-aligned, so use their footprint's reach in the wall-normal direction.
    const normalReach = Math.abs(segment.normal.x) * candidate.width / 2 + Math.abs(segment.normal.y) * candidate.depth / 2;
    return { ...candidate, position: inside(normalReach), source: "user_confirmed" as const, confirmed: true };
  }) : room.clearanceZones;

  return {
    ...room,
    features: room.features.map((feature) => feature.id === featureId ? movedDoor : feature),
    clearanceZones,
    geometryVersion: room.geometryVersion + 1,
  };
}
