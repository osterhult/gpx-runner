import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const OSRM_BASE = 'https://router.project-osrm.org';

function calculateFamiliarity(routeCoords: [number, number][], existingRoutes: { coordinates: [number, number][] }[]): number {
  if (existingRoutes.length === 0) return 0;
  
  let familiarPoints = 0;
  const totalPoints = routeCoords.length;
  
  const familiarCoords = new Set<string>();
  existingRoutes.forEach(route => {
    route.coordinates.forEach(coord => {
      const key = `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
      familiarCoords.add(key);
    });
  });
  
  routeCoords.forEach(coord => {
    const key = `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
    if (familiarCoords.has(key)) {
      familiarPoints++;
    }
  });
  
  return familiarPoints / totalPoints;
}

interface SuggestionRequest {
  distance: number;
  avoidFamiliar: boolean;
  centerLat: number;
  centerLon: number;
  existingRoutes?: { coordinates: [number, number][] }[];
}

export async function POST(request: NextRequest) {
  try {
    const body: SuggestionRequest = await request.json();
    const { distance, avoidFamiliar, centerLat, centerLon, existingRoutes } = body;

    // Calculate target point at approximately half the distance (for out-and-back)
    // This ensures we get roughly the target distance
    const halfDistanceKm = distance / 2;
    const degreesPerKm = 0.009; // Approximate degrees per km
    
    // Generate a random angle for the direction
    const angle = Math.random() * 2 * Math.PI;
    
    // Calculate waypoint at half distance
    const waypointLat = centerLat + Math.sin(angle) * halfDistanceKm * degreesPerKm;
    const waypointLon = centerLon + Math.cos(angle) * halfDistanceKm * degreesPerKm;
    
    // If familiar mode, find a waypoint near existing routes
    if (!avoidFamiliar && existingRoutes && existingRoutes.length > 0) {
      const allCoords = existingRoutes.flatMap(r => r.coordinates);
      if (allCoords.length > 0) {
        // Pick a random point from existing routes as the waypoint
        const randomIdx = Math.floor(Math.random() * Math.min(100, allCoords.length));
        const existingPoint = allCoords[randomIdx];
        // Use it if it's not too far from center (within ~10km)
        if (Math.abs(existingPoint[1] - centerLat) < 0.1 && Math.abs(existingPoint[0] - centerLon) < 0.1) {
          // Use existing route area but go to a point on existing routes
          const existingAngle = Math.atan2(existingPoint[1] - centerLat, existingPoint[0] - centerLon);
          const existingDist = Math.sqrt(
            Math.pow(existingPoint[1] - centerLat, 2) + 
            Math.pow(existingPoint[0] - centerLon, 2)
          ) * 111; // Convert to km approx
          
          if (existingDist > 0.5) {
            // Use a point on an existing route that's at about half our target distance
            const waypointAngle = existingAngle + (Math.random() - 0.5) * 0.5;
            const waypointDist = (halfDistanceKm / 111) * (0.8 + Math.random() * 0.4);
            // Actually get coordinates from an existing route point within our target distance
            const relevantPoints = allCoords.filter(c => {
              const d = Math.sqrt(Math.pow(c[1] - centerLat, 2) + Math.pow(c[0] - centerLon, 2)) * 111;
              return d >= halfDistanceKm * 0.3 && d <= halfDistanceKm * 0.7;
            });
            
            if (relevantPoints.length > 0) {
              const selectedPoint = relevantPoints[Math.floor(Math.random() * relevantPoints.length)];
              return NextResponse.json({
                coordinates: [[centerLon, centerLat], [selectedPoint[0], selectedPoint[1]], [centerLon, centerLat]],
                distance: Math.round(distance * 1000),
                elevationGain: Math.round(distance * 10),
                name: `Familiar Loop - ${distance}km`,
                isRoundTrip: true,
                startPoint: [centerLon, centerLat],
                familiarityScore: 100,
              });
            }
          }
        }
      }
    }

    // Build route: start -> waypoint -> start (round trip)
    const coordString = `${centerLon},${centerLat};${waypointLon},${waypointLat};${centerLon},${centerLat}`;
    
    const response = await axios.get(
      `${OSRM_BASE}/route/v1/foot/${coordString}`,
      {
        params: {
          overview: 'full',
          geometries: 'geojson',
          steps: 'false',
        },
        timeout: 20000,
      }
    );

    if (response.data.code !== 'Ok' || !response.data.routes || response.data.routes.length === 0) {
      return NextResponse.json(
        { error: 'No route found. Try a different location.' },
        { status: 404 }
      );
    }

    const route = response.data.routes[0];
    const coords = route.geometry.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]);
    
    // Calculate actual distance
    const routeDistance = route.distance;
    
    // If route is too different from target, adjust
    const ratio = routeDistance / (distance * 1000);
    
    // Calculate familiarity
    const familiarity = existingRoutes ? calculateFamiliarity(coords, existingRoutes) : 0;
    const estimatedElevation = Math.round(distance * 10);

    const routeNames = [
      'Morning Loop', 'Evening Run', 'Park Circuit', 'Urban Loop',
      'Nature Trail', 'City Route', 'Sunset Run', 'Quick Loop',
      'Round Route', 'Neighborhood Loop',
    ];
    const name = routeNames[Math.floor(Math.random() * routeNames.length)];

    return NextResponse.json({
      coordinates: coords,
      distance: routeDistance,
      elevationGain: estimatedElevation,
      name: `${name} - ${distance}km`,
      isRoundTrip: true,
      startPoint: [centerLon, centerLat] as [number, number],
      familiarityScore: Math.round(familiarity * 100),
    });

  } catch (error: any) {
    console.error('Route suggestion error:', error.response?.data || error.message);
    
    return NextResponse.json(
      { error: 'Failed to generate route. Please try again.' },
      { status: 500 }
    );
  }
}