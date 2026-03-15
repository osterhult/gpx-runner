import { generateTrainingRoutes } from "../../../../src/api/routeGeneratorService";

type RequestBody = {
  start?: { lat?: number; lng?: number };
  targetDistanceKm?: number;
  toleranceKm?: number;
  familiarityMode?: "familiar" | "mixed" | "new";
  gpxFiles?: string[];
  familiarityTracks?: Array<Array<[number, number]>>;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as RequestBody;

    if (!body.start || !Number.isFinite(body.start.lat) || !Number.isFinite(body.start.lng)) {
      return Response.json({ error: "Invalid start coordinate" }, { status: 400 });
    }
    if (!Number.isFinite(body.targetDistanceKm) || (body.targetDistanceKm ?? 0) <= 0) {
      return Response.json({ error: "Invalid targetDistanceKm" }, { status: 400 });
    }

    const familiarityTracks = (body.familiarityTracks ?? []).map((track) =>
      track.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    ).filter((track) => track.length >= 2);

    const result = await generateTrainingRoutes({
      start: { lat: Number(body.start!.lat), lng: Number(body.start!.lng) },
      targetDistanceKm: Number(body.targetDistanceKm),
      toleranceKm: Number.isFinite(body.toleranceKm) ? Number(body.toleranceKm) : 1,
      familiarityMode: body.familiarityMode ?? "mixed",
      gpxFiles: body.gpxFiles ?? [],
      familiarityTracks,
      maxCandidates: familiarityTracks.length > 0 ? 96 : 72,
      alternatives: 3,
    });

    if (!result.routes.length) {
      return Response.json({ error: "Could not find a road/trail loop that matched the requested distance and familiarity." }, { status: 422 });
    }

    return Response.json({
      routes: result.routes.map((route) => ({
        id: route.id,
        name: `${body.familiarityMode === 'familiar' ? 'Familiar' : body.familiarityMode === 'new' ? 'New' : 'Mixed'} Loop - ${(route.distanceMeters / 1000).toFixed(1)}km`,
        coordinates: route.geometry.map((p) => [p.lng, p.lat] as [number, number]),
        distance: route.distanceMeters,
        elevationGain: 0,
        startPoint: [Number(body.start!.lng), Number(body.start!.lat)] as [number, number],
        isRoundTrip: true,
        familiarityScore: Math.round(route.familiarityRatio * 100),
        score: route.score,
        debug: route.debug,
      })),
      rejectedCount: result.rejectedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
