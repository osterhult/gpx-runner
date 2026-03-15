import { generateTrainingRoutes } from "../../../../src/api/routeGeneratorService";

type RequestBody = {
  start?: { lat?: number; lng?: number };
  targetDistanceKm?: number;
  toleranceKm?: number;
  familiarityMode?: "familiar" | "mixed" | "new";
  gpxFiles?: string[];
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

    const result = await generateTrainingRoutes({
      start: { lat: Number(body.start.lat), lng: Number(body.start.lng) },
      targetDistanceKm: Number(body.targetDistanceKm),
      toleranceKm: Number.isFinite(body.toleranceKm) ? Number(body.toleranceKm) : 1,
      familiarityMode: body.familiarityMode ?? "mixed",
      gpxFiles: body.gpxFiles ?? [],
      maxCandidates: 180,
      alternatives: 3,
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
