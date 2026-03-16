import { FamiliarityMode, LatLng } from "../types";
import { destinationPoint, haversineMeters } from "./utils/geo";

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
  { name: "triangle-even", points: [{ angle: 0, scale: 1 }, { angle: 120, scale: 1.02 }, { angle: 240, scale: 0.98 }] },
  { name: "triangle-wide", points: [{ angle: 0, scale: 1.04 }, { angle: 115, scale: 0.96 }, { angle: 235, scale: 1.0 }] },
  { name: "square-even", points: [{ angle: 0, scale: 1 }, { angle: 90, scale: 1.02 }, { angle: 180, scale: 0.98 }, { angle: 270, scale: 1.0 }] },
  { name: "square-tilted", points: [{ angle: 35, scale: 1.02 }, { angle: 125, scale: 0.98 }, { angle: 215, scale: 1.02 }, { angle: 305, scale: 0.98 }] },
  { name: "pentagon-even", points: [{ angle: 0, scale: 1 }, { angle: 72, scale: 1.01 }, { angle: 144, scale: 0.99 }, { angle: 216, scale: 1.01 }, { angle: 288, scale: 0.99 }] },
  { name: "pentagon-soft", points: [{ angle: 18, scale: 1.03 }, { angle: 88, scale: 0.97 }, { angle: 162, scale: 1.0 }, { angle: 234, scale: 0.98 }, { angle: 306, scale: 1.02 }] },
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
    case "familiar": return [0.92, 1.0, 1.08];
    case "new": return [0.92, 1.0, 1.08, 1.16, 1.24];
    default: return [0.9, 0.98, 1.06, 1.14];
  }
}

function bearingFrom(start: LatLng, point: LatLng): number {
  const y = Math.sin((point.lng - start.lng) * Math.PI / 180) * Math.cos(point.lat * Math.PI / 180);
  const x = Math.cos(start.lat * Math.PI / 180) * Math.sin(point.lat * Math.PI / 180) -
    Math.sin(start.lat * Math.PI / 180) * Math.cos(point.lat * Math.PI / 180) * Math.cos((point.lng - start.lng) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function buildFamiliarCandidates(start: LatLng, targetDistanceMeters: number, familiarityTracks: LatLng[][], maxCandidates: number): CandidateWaypoints[] {
  const idealRadius = Math.max(160, targetDistanceMeters / (2 * Math.PI));
  const minRadius = Math.max(80, idealRadius * 0.45);
  const maxRadius = idealRadius * 1.75;

  const buckets = Array.from({ length: 12 }, () => [] as LatLng[]);
  for (const track of familiarityTracks) {
    for (const point of track) {
      const r = haversineMeters(start, point);
      if (r < minRadius || r > maxRadius) continue;
      const sector = Math.floor(bearingFrom(start, point) / 30) % 12;
      if (buckets[sector].length < 8) buckets[sector].push(point);
    }
  }

  const results: CandidateWaypoints[] = [];
  const patterns = [
    [0, 3, 6, 9], [1, 4, 7, 10], [2, 5, 8, 11],
    [0, 4, 8], [1, 5, 9], [2, 6, 10], [3, 7, 11],
    [0, 3, 7], [1, 4, 8], [2, 6, 9],
  ];

  for (const pattern of patterns) {
    const options = pattern.map((idx) => buckets[idx]).filter((pts) => pts.length > 0);
    if (options.length < Math.min(3, pattern.length)) continue;
    const chosen: LatLng[] = [];
    for (let i = 0; i < pattern.length; i += 1) {
      const pts = buckets[pattern[i]];
      if (!pts.length) continue;
      const point = pts[Math.min(pts.length - 1, i % pts.length)];
      if (chosen.every((existing) => haversineMeters(existing, point) > 90)) chosen.push(point);
    }
    if (chosen.length >= 3) {
      results.push({ seed: `familiar:${pattern.join('-')}:0`, waypoints: chosen });
      if (results.length >= maxCandidates) break;
    }
  }

  return results;
}

export function buildLoopWaypointCandidates(
  start: LatLng,
  targetDistanceMeters: number,
  maxCandidates: number,
  familiarityMode: FamiliarityMode = "mixed",
  familiarityTracks: LatLng[][] = [],
): CandidateWaypoints[] {
  const results: CandidateWaypoints[] = [];

  if (familiarityMode === "familiar" && familiarityTracks.length > 0) {
    results.push(...buildFamiliarCandidates(start, targetDistanceMeters, familiarityTracks, Math.max(12, Math.floor(maxCandidates / 3))));
  }

  const bearingStep = targetDistanceMeters <= 5000 ? 18 : targetDistanceMeters <= 12000 ? 15 : 12;
  const wobbleSets = [[0,0,0,0,0],[0,4,-4,6,-6],[0,-6,5,-5,4]];

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
          results.push({ seed: `${shape.name}:${baseBearing}:${radiusMultiplier}:${wobble.join(',')}`, waypoints });
          if (results.length >= maxCandidates) return results;
        }
      }
    }
  }

  return results;
}
