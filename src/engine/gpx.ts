import { XMLParser } from "fast-xml-parser";
import { LatLng } from "../types";

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseGpxToTrackPoints(gpxXml: string): LatLng[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });

  const parsed = parser.parse(gpxXml);
  const gpx = parsed?.gpx;
  const tracks = ensureArray(gpx?.trk);

  const points: LatLng[] = [];

  for (const track of tracks) {
    const segments = ensureArray(track?.trkseg);
    for (const segment of segments) {
      const trkpts = ensureArray(segment?.trkpt);
      for (const point of trkpts) {
        const lat = Number(point?.lat);
        const lng = Number(point?.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          points.push({ lat, lng });
        }
      }
    }
  }

  return points;
}
