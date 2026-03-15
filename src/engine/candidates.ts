import { FamiliarityMode, LatLng } from "../types";
import { destinationPoint } from "./utils/geo";

export type CandidateWaypoints = {
  seed: string;
  waypoints: LatLng[];
};

type ShapePoint = { angle: number; scale: number };
type ShapeTemplate = {
  name: string;
  points: ShapePoint[];
};

const SHAPES: ShapeTemplate[] = [
  {
    name: "triangle-even",
    points: [
      { angle: 0, scale: 1 },
      { angle: 120, scale: 1.02 },
      { angle: 240, scale: 0.98 },
    ],
  },
  {
    name: "triangle-wide",
    points: [
      { angle: 0, scale: 1.04 },
      { angle: 115, scale: 0.96 },
      { angle: 235, scale: 1.0 },
    ],
  },
  {
    name: "square-even",
    points: [
      { angle: 0, scale: 1 },
      { angle: 90, scale: 1.02 },
      { angle: 180, scale: 0.98 },
      { angle: 270, scale: 1.0 },
    ],
  },
  {
    name: "square-tilted",
    points: [
      { angle: 35, scale: 1.02 },
      { angle: 125, scale: 0.98 },
      { angle: 215, scale: 1.02 },
      { angle: 305, scale: 0.98 },
    ],
  },
  {
    name: "pentagon-even",
    points: [
      { angle: 0, scale: 1 },
      { angle: 72, scale: 1.01 },
      { angle: 144, scale: 0.99 },
      { angle: 216, scale: 1.01 },
      { angle: 288, scale: 0.99 },
    ],
  },
  {
    name: "pentagon-soft",
    points: [
      { angle: 18, scale: 1.03 },
      { angle: 88, scale: 0.97 },
      { angle: 162, scale: 1.0 },
      { angle: 234, scale: 0.98 },
      { angle: 306, scale: 1.02 },
    ],
  },
];

function normalizedPerimeter(shape: ShapeTemplate): number {
  let total = 0;
  const points = shape.points;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ax = Math.cos((a.angle * Math.PI) / 180) * a.scale;
    const ay = Math.sin((a.angle * Math.PI) / 180) * a.scale;
    const bx = Math.cos((b.angle * Math.PI) / 180) * b.scale;
    const by = Math.sin((b.angle * Math.PI) / 180) * b.scale;
    total += Math.hypot(ax - bx, ay - by);
  }

  return total;
}

function radiusMultipliers(mode: FamiliarityMode): number[] {
  switch (mode) {
    case "familiar":
      return [0.88, 0.94, 1.0, 1.06, 1.12];
    case "new":
      return [0.92, 1.0, 1.08, 1.16, 1.24];
    case "mixed":
    default:
      return [0.9, 0.97, 1.04, 1.11, 1.18];
  }
}

export function buildLoopWaypointCandidates(
  start: LatLng,
  targetDistanceMeters: number,
  maxCandidates: number,
  familiarityMode: FamiliarityMode = "mixed",
): CandidateWaypoints[] {
  const results: CandidateWaypoints[] = [];
  const bearingStep = targetDistanceMeters <= 5000 ? 18 : targetDistanceMeters <= 12000 ? 15 : 12;
  const wobbleSets = [
    [0, 0, 0, 0, 0],
    [0, 4, -4, 6, -6],
    [0, -6, 5, -5, 4],
  ];

  for (const shape of SHAPES) {
    const unitPerimeter = normalizedPerimeter(shape);
    const idealRadius = Math.max(180, targetDistanceMeters / (unitPerimeter * 1.12));

    for (let baseBearing = 0; baseBearing < 360; baseBearing += bearingStep) {
      for (const radiusMultiplier of radiusMultipliers(familiarityMode)) {
        for (const wobble of wobbleSets) {
          const waypoints = shape.points.map((point, idx) => {
            const angle = (baseBearing + point.angle + wobble[idx % wobble.length] + 360) % 360;
            const radius = idealRadius * radiusMultiplier * point.scale;
            return destinationPoint(start, angle, radius);
          });

          results.push({
            seed: `${shape.name}:${baseBearing}:${radiusMultiplier}:${wobble.join(",")}`,
            waypoints,
          });

          if (results.length >= maxCandidates) {
            return results;
          }
        }
      }
    }
  }

  return results;
}
