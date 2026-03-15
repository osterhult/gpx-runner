import { LatLng, RouteSegment } from "../types";
import { midpoint, pointToSegmentDistanceMeters, toSegments } from "./utils/geo";

export type FamiliarityIndex = {
  familiarSegments: RouteSegment[];
};

export function buildFamiliarityIndex(trackCollections: LatLng[][]): FamiliarityIndex {
  const rawSegments = trackCollections.flatMap((track) => toSegments(track).filter((s) => s.distanceMeters >= 8));
  const familiarSegments: RouteSegment[] = [];

  for (const segment of rawSegments) {
    const duplicate = familiarSegments.some(
      (existing) =>
        pointToSegmentDistanceMeters(segment.from, existing.from, existing.to) <= 12 &&
        pointToSegmentDistanceMeters(segment.to, existing.from, existing.to) <= 12,
    );

    if (!duplicate) {
      familiarSegments.push(segment);
    }
  }

  return { familiarSegments };
}

export function computeFamiliarityRatio(routeSegments: RouteSegment[], index: FamiliarityIndex): number {
  if (routeSegments.length === 0) return 0;
  let familiarDistance = 0;
  let totalDistance = 0;

  for (const segment of routeSegments) {
    totalDistance += segment.distanceMeters;
    familiarDistance += segment.distanceMeters * familiarityWeight(segment, index.familiarSegments);
  }

  if (totalDistance === 0) return 0;
  return Math.max(0, Math.min(1, familiarDistance / totalDistance));
}

function familiarityWeight(segment: RouteSegment, familiarSegments: RouteSegment[]): number {
  const mid = midpoint(segment.from, segment.to);
  let best = 0;

  for (const familiar of familiarSegments) {
    if (Math.abs(familiar.distanceMeters - segment.distanceMeters) > 180) continue;

    const fromNear = pointToSegmentDistanceMeters(segment.from, familiar.from, familiar.to);
    const toNear = pointToSegmentDistanceMeters(segment.to, familiar.from, familiar.to);
    const midNear = pointToSegmentDistanceMeters(mid, familiar.from, familiar.to);

    const avg = (fromNear + toNear + midNear) / 3;

    if (avg <= 12) {
      best = Math.max(best, 1);
    } else if (avg <= 22) {
      best = Math.max(best, 0.85);
    } else if (avg <= 35) {
      best = Math.max(best, 0.6);
    } else if (avg <= 50) {
      best = Math.max(best, 0.3);
    }

    if (best >= 1) return 1;
  }

  return best;
}
