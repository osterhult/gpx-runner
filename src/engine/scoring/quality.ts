import { GeneratedRoute, LatLng, RouteSegment } from "../../types";
import { haversineMeters, pointToSegmentDistanceMeters } from "../utils/geo";

export function computeDistancePenalty(distanceMeters: number, targetMeters: number): number {
  return Math.abs(distanceMeters - targetMeters) / targetMeters;
}

export function computeOutAndBackRatio(segments: RouteSegment[]): number {
  if (segments.length < 2) return 0;

  let repeatedDistance = 0;
  let totalDistance = 0;

  for (let i = 0; i < segments.length; i += 1) {
    totalDistance += segments[i].distanceMeters;

    for (let j = i + 2; j < segments.length; j += 1) {
      const sameDirection =
        pointToSegmentDistanceMeters(segments[i].from, segments[j].from, segments[j].to) < 15 &&
        pointToSegmentDistanceMeters(segments[i].to, segments[j].from, segments[j].to) < 15;

      const reverseDirection =
        pointToSegmentDistanceMeters(segments[i].from, segments[j].to, segments[j].from) < 15 &&
        pointToSegmentDistanceMeters(segments[i].to, segments[j].to, segments[j].from) < 15;

      if (sameDirection || reverseDirection) {
        repeatedDistance += Math.min(segments[i].distanceMeters, segments[j].distanceMeters);
        break;
      }
    }
  }

  return totalDistance === 0 ? 0 : Math.min(1, repeatedDistance / totalDistance);
}

export function computeClosureErrorMeters(points: GeneratedRoute["geometry"]): number {
  if (points.length < 2) return 0;
  return haversineMeters(points[0], points[points.length - 1]);
}

export function computeLoopShapeMetrics(points: LatLng[], start: LatLng, targetMeters: number): {
  angularCoverage: number;
  radialStdRatio: number;
  minRadiusRatio: number;
} {
  const samples = samplePoints(points, Math.min(24, Math.max(8, Math.floor(points.length / 5))));
  const bearings = new Set<number>();
  const radii: number[] = [];

  for (const point of samples) {
    const radius = haversineMeters(start, point);
    if (radius < 20) continue;
    radii.push(radius);
    bearings.add(Math.floor((bearingBetween(start, point) + 360) % 360 / 30));
  }

  if (radii.length === 0) {
    return { angularCoverage: 0, radialStdRatio: 1, minRadiusRatio: 0 };
  }

  const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const variance = radii.reduce((sum, value) => sum + (value - mean) ** 2, 0) / radii.length;
  const std = Math.sqrt(variance);
  const expectedRadius = Math.max(120, targetMeters / (2 * Math.PI));

  return {
    angularCoverage: bearings.size / 12,
    radialStdRatio: std / Math.max(mean, 1),
    minRadiusRatio: Math.min(...radii) / expectedRadius,
  };
}

function samplePoints(points: LatLng[], desired: number): LatLng[] {
  if (points.length <= desired) return points;
  const step = Math.max(1, Math.floor(points.length / desired));
  const sampled: LatLng[] = [];

  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }

  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }

  return sampled;
}

function bearingBetween(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRadians(b.lng - a.lng)) * Math.cos(toRadians(b.lat));
  const x =
    Math.cos(toRadians(a.lat)) * Math.sin(toRadians(b.lat)) -
    Math.sin(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.cos(toRadians(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function scoreRoute(params: {
  distanceMeters: number;
  targetMeters: number;
  familiarityRatio: number;
  targetFamiliarityRange: { min: number; max: number };
  outAndBackRatio: number;
  closureErrorMeters: number;
  angularCoverage: number;
  radialStdRatio: number;
  minRadiusRatio: number;
}): { score: number; debug: Record<string, number> } {
  const distancePenalty = computeDistancePenalty(params.distanceMeters, params.targetMeters);
  const familiarityCenter = (params.targetFamiliarityRange.min + params.targetFamiliarityRange.max) / 2;
  const familiarityPenalty = Math.abs(params.familiarityRatio - familiarityCenter);
  const outAndBackPenalty = params.outAndBackRatio;
  const closurePenalty = Math.min(1, params.closureErrorMeters / 60);
  const angularPenalty = 1 - Math.min(1, params.angularCoverage);
  const radialPenalty = Math.min(1, params.radialStdRatio / 0.42);
  const centerRevisitPenalty = Math.max(0, 0.75 - params.minRadiusRatio);

  const score =
    100 -
    distancePenalty * 55 -
    familiarityPenalty * 28 -
    outAndBackPenalty * 55 -
    closurePenalty * 10 -
    angularPenalty * 25 -
    radialPenalty * 14 -
    centerRevisitPenalty * 18;

  return {
    score,
    debug: {
      distancePenalty,
      familiarityPenalty,
      outAndBackPenalty,
      closurePenalty,
      angularPenalty,
      radialPenalty,
      centerRevisitPenalty,
    },
  };
}
