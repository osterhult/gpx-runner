import crypto from "node:crypto";
import { buildLoopWaypointCandidates } from "./candidates";
import { familiarityRangeForMode } from "./config";
import { buildFamiliarityIndex, computeFamiliarityRatio } from "./familiarity";
import { parseGpxToTrackPoints } from "./gpx";
import {
  computeClosureErrorMeters,
  computeLoopShapeMetrics,
  computeOutAndBackRatio,
  scoreRoute,
} from "./scoring/quality";
import { normalizeLoop, toSegments } from "./utils/geo";
import { GenerateRouteInput, GeneratedRoute, RouteProvider } from "../types";

export async function generateRoutes(
  provider: RouteProvider,
  input: GenerateRouteInput,
): Promise<{ routes: GeneratedRoute[]; rejectedCount: number }> {
  const toleranceKm = input.toleranceKm ?? 1;
  const familiarityMode = input.familiarityMode ?? "mixed";
  const maxCandidates = input.maxCandidates ?? 180;
  const alternatives = input.alternatives ?? 3;
  const targetMeters = input.targetDistanceKm * 1000;
  const toleranceMeters = toleranceKm * 1000;
  const targetFamiliarityRange = familiarityRangeForMode(familiarityMode);

  const parsedTracks = (input.gpxFiles ?? [])
    .map((gpx) => parseGpxToTrackPoints(gpx))
    .filter((track) => track.length >= 2);
  const familiarityIndex = buildFamiliarityIndex(parsedTracks);

  const candidateWaypoints = buildLoopWaypointCandidates(input.start, targetMeters, maxCandidates, familiarityMode);
  const accepted: GeneratedRoute[] = [];
  const nearMisses: GeneratedRoute[] = [];
  let rejectedCount = 0;

  for (const candidate of candidateWaypoints) {
    const requestPoints = [input.start, ...candidate.waypoints, input.start];
    const providerResult = await provider.route({ coordinates: requestPoints });

    if (!providerResult || providerResult.geometry.length < 2) {
      rejectedCount += 1;
      continue;
    }

    const loopGeometry = normalizeLoop(providerResult.geometry);
    const segments = toSegments(loopGeometry);
    const familiarityRatio =
      familiarityIndex.familiarSegments.length > 0
        ? computeFamiliarityRatio(segments, familiarityIndex)
        : familiarityMode === "new"
          ? 0
          : familiarityMode === "familiar"
            ? 1
            : 0.5;

    const outAndBackRatio = computeOutAndBackRatio(segments);
    const closureErrorMeters = computeClosureErrorMeters(loopGeometry);
    const loopMetrics = computeLoopShapeMetrics(loopGeometry, input.start, targetMeters);

    const distanceDelta = Math.abs(providerResult.distanceMeters - targetMeters);
    const distanceOk = distanceDelta <= toleranceMeters;
    const familiarityOk =
      familiarityIndex.familiarSegments.length === 0 ||
      (familiarityRatio >= targetFamiliarityRange.min && familiarityRatio <= targetFamiliarityRange.max);
    const loopOk =
      outAndBackRatio <= 0.33 &&
      closureErrorMeters <= 35 &&
      loopMetrics.angularCoverage >= 0.58 &&
      loopMetrics.minRadiusRatio >= 0.42;

    const { score, debug } = scoreRoute({
      distanceMeters: providerResult.distanceMeters,
      targetMeters,
      familiarityRatio,
      targetFamiliarityRange,
      outAndBackRatio,
      closureErrorMeters,
      ...loopMetrics,
    });

    const builtRoute: GeneratedRoute = {
      id: crypto.randomUUID(),
      distanceMeters: providerResult.distanceMeters,
      geometry: loopGeometry,
      segments,
      familiarityRatio,
      score,
      debug: {
        seed: candidate.seed,
        targetMeters,
        closureErrorMeters,
        outAndBackRatio,
        angularCoverage: loopMetrics.angularCoverage,
        radialStdRatio: loopMetrics.radialStdRatio,
        minRadiusRatio: loopMetrics.minRadiusRatio,
        ...debug,
      },
    };

    if (distanceOk && familiarityOk && loopOk) {
      accepted.push(builtRoute);
    } else {
      if (
        distanceDelta <= toleranceMeters * 1.35 &&
        outAndBackRatio <= 0.45 &&
        loopMetrics.angularCoverage >= 0.45
      ) {
        nearMisses.push(builtRoute);
      }
      rejectedCount += 1;
    }
  }

  const bestAccepted = dedupeRoutes(accepted).sort((a, b) => b.score - a.score);
  if (bestAccepted.length >= alternatives) {
    return { routes: bestAccepted.slice(0, alternatives), rejectedCount };
  }

  const fallback = dedupeRoutes(nearMisses)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, alternatives - bestAccepted.length));

  return {
    routes: [...bestAccepted, ...fallback],
    rejectedCount,
  };
}

function dedupeRoutes(routes: GeneratedRoute[]): GeneratedRoute[] {
  const kept: GeneratedRoute[] = [];

  for (const route of routes) {
    const alreadySimilar = kept.some((existing) => {
      const distDiff = Math.abs(existing.distanceMeters - route.distanceMeters);
      const famDiff = Math.abs(existing.familiarityRatio - route.familiarityRatio);
      const geomA = geometrySignature(existing.geometry);
      const geomB = geometrySignature(route.geometry);
      return distDiff < 250 && famDiff < 0.1 && overlapRatio(geomA, geomB) >= 0.72;
    });

    if (!alreadySimilar) {
      kept.push(route);
    }
  }

  return kept;
}

function geometrySignature(points: GenerateRouteInput["start"][]): Set<string> {
  return new Set(points.map((p) => `${p.lat.toFixed(3)}:${p.lng.toFixed(3)}`));
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const key of a) {
    if (b.has(key)) shared += 1;
  }
  return shared / Math.max(1, Math.min(a.size, b.size));
}
