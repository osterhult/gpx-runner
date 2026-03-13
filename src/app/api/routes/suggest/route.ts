import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const OSRM_BASE = 'https://router.project-osrm.org';

function calculateFamiliarity(routeCoords: [number, number][], existingRoutes: { coordinates: [number, number][] }[]): number {
  if (existingRoutes.length === 0 || routeCoords.length === 0) return 0;
  
  const familiarCoords = new Set<string>();
  existingRoutes.forEach(route => {
    route.coordinates.forEach(coord => {
      const key = `${coord[0].toFixed(3)},${coord[1].toFixed(3)}`;
      familiarCoords.add(key);
    });
  });
  
  let familiarPoints = 0;
  routeCoords.forEach(coord => {
    const key = `${coord[0].toFixed(3)},${coord[1].toFixed(3)}`;
    if (familiarCoords.has(key)) familiarPoints++;
  });
  
  return familiarPoints / routeCoords.length;
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

    // Target distance in meters
    const targetMeters = distance * 1000;
    
    // Calculate waypoints in a rough circle
    // For a circular route, we need to go around, not just out and back
    const numPoints = 5; // start + 3 waypoints + end (which is same as start)
    const radiusKm = targetMeters / 1000 / (2 * Math.PI); // Approximate radius for circle
    
    // Add some randomness to make it not always a perfect circle
    const radiusDegrees = radiusKm * 0.009 * (0.9 + Math.random() * 0.2);
    
    // Generate waypoints at different angles to form a more circular route
    const waypoints: [number, number][] = [];
    const angles = [];
    
    // Create waypoints at angles: 45°, 90°, 135°, etc. (roughly going around)
    for (let i = 1; i < numPoints; i++) {
      const angle = (i / (numPoints - 1)) * Math.PI * 1.5 + (Math.random() - 0.5) * 0.3;
      angles.push(angle);
      
      const lat = centerLat + Math.sin(angle) * radiusDegrees;
      const lon = centerLon + Math.cos(angle) * radiusDegrees;
      waypoints.push([lon, lat]);
    }
    
    // If familiar mode, find waypoints near existing routes
    if (!avoidFamiliar && existingRoutes && existingRoutes.length > 0) {
      const allCoords = existingRoutes.flatMap(r => r.coordinates);
      if (allCoords.length > 0) {
        // Find points from existing routes
        const relevantPoints = allCoords.filter(c => {
          const d = Math.sqrt(
            Math.pow(c[1] - centerLat, 2) + 
            Math.pow(c[0] - centerLon, 2)
          ) * 111;
          return d >= radiusKm * 0.5 && d <= radiusKm * 1.5;
        });
        
        if (relevantPoints.length >= 2) {
          // Use 2-3 points from existing routes as waypoints
          const selectedPoints = relevantPoints.slice(0, Math.min(3, relevantPoints.length));
          
          const routeCoords: [number, number][] = [
            [centerLon, centerLat],
            ...selectedPoints.map(p => [p[0], p[1]] as [number, number]),
            [centerLon, centerLat]
          ];
          
          const familiarity = calculateFamiliarity(routeCoords, existingRoutes);
          
          return NextResponse.json({
            coordinates: routeCoords,
            distance: targetMeters,
            elevationGain: Math.round(distance * 10),
            name: `Familiar Loop - ${distance}km`,
            isRoundTrip: true,
            startPoint: [centerLon, centerLat],
            familiarityScore: Math.round(familiarity * 100),
          });
        }
      }
    }

    // Build route with multiple waypoints for circular path
    const allWaypoints = [...waypoints, [centerLon, centerLat]]; // Return to start
    const coordString = `${centerLon},${centerLat};` + waypoints.map(w => `${w[0]},${w[1]}`).join(';') + `;${centerLon},${centerLat}`;
    
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
      // Fallback to simple out-and-back if circular fails
      const halfAngle = Math.PI;
      const halfLat = centerLat + Math.sin(halfAngle) * radiusDegrees;
      const halfLon = centerLon + Math.cos(halfAngle) * radiusDegrees;
      
      const fallbackCoords: [number, number][] = [
        [centerLon, centerLat],
        [halfLon, halfLat],
        [centerLon, centerLat]
      ];
      
      return NextResponse.json({
        coordinates: fallbackCoords,
        distance: targetMeters,
        elevationGain: Math.round(distance * 10),
        name: `Loop - ${distance}km`,
        isRoundTrip: true,
        startPoint: [centerLon, centerLat],
        familiarityScore: 0,
      });
    }

    const route = response.data.routes[0];
    const coords = route.geometry.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]);
    const routeDistance = route.distance;
    const familiarity = existingRoutes ? calculateFamiliarity(coords, existingRoutes) : 0;
    
    // Verify route is reasonable
    if (coords.length < 5 || routeDistance < targetMeters * 0.3 || routeDistance > targetMeters * 3) {
      // Return fallback
      const halfAngle = Math.PI;
      const halfLat = centerLat + Math.sin(halfAngle) * radiusDegrees;
      const halfLon = centerLon + Math.cos(halfAngle) * radiusDegrees;
      
      const fallbackCoords: [number, number][] = [
        [centerLon, centerLat],
        [halfLon, halfLat],
        [centerLon, centerLat]
      ];
      
      return NextResponse.json({
        coordinates: fallbackCoords,
        distance: targetMeters,
        elevationGain: Math.round(distance * 10),
        name: `Loop - ${distance}km`,
        isRoundTrip: true,
        startPoint: [centerLon, centerLat],
        familiarityScore: 0,
      });
    }

    const routeNames = [
      'Morning Loop', 'Evening Run', 'Park Circuit', 'Urban Loop',
      'Nature Trail', 'City Route', 'Sunset Run', 'Quick Loop',
      'Round Route', 'Neighborhood Loop', 'Circle Run', 'Circuit',
    ];

    return NextResponse.json({
      coordinates: coords,
      distance: routeDistance,
      elevationGain: Math.round(distance * 10),
      name: `${routeNames[Math.floor(Math.random() * routeNames.length)]} - ${distance}km`,
      isRoundTrip: true,
      startPoint: [centerLon, centerLat],
      familiarityScore: Math.round(familiarity * 100),
    });

  } catch (error: any) {
    console.error('Route suggestion error:', error.message);
    
    return NextResponse.json(
      { error: 'Failed to generate route. Please try again.' },
      { status: 500 }
    );
  }
}