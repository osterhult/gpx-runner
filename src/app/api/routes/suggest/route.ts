import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const OSRM_BASE = 'https://router.project-osrm.org';

// Simple function to check if two coordinates are close (within ~50 meters)
function isClose(coord1: [number, number], coord2: [number, number]): boolean {
  const lat1 = coord1[1], lon1 = coord1[0];
  const lat2 = coord2[1], lon2 = coord2[0];
  // Approximate: 1 degree ≈ 111km, so 0.0005 ≈ 50m
  return Math.abs(lat1 - lat2) < 0.0005 && Math.abs(lon1 - lon2) < 0.0005;
}

// Calculate how much of the route overlaps with familiar paths
function calculateFamiliarity(routeCoords: [number, number][], existingRoutes: { coordinates: [number, number][] }[]): number {
  if (existingRoutes.length === 0) return 0;
  
  let familiarPoints = 0;
  const totalPoints = routeCoords.length;
  
  // Flatten all existing route coordinates
  const familiarCoords = new Set<string>();
  existingRoutes.forEach(route => {
    route.coordinates.forEach(coord => {
      // Round to 4 decimal places to group nearby points
      const key = `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
      familiarCoords.add(key);
    });
  });
  
  // Count how many points in the new route are familiar
  routeCoords.forEach(coord => {
    const key = `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
    if (familiarCoords.has(key)) {
      familiarPoints++;
    }
  });
  
  return familiarPoints / totalPoints;
}

interface SuggestionRequest {
  distance: number; // km
  type: 'road' | 'trail' | 'mixed';
  avoidFamiliar: boolean;
  centerLat: number;
  centerLon: number;
  existingRoutes?: { coordinates: [number, number][] }[];
}

export async function POST(request: NextRequest) {
  try {
    const body: SuggestionRequest = await request.json();
    const { distance, avoidFamiliar, centerLat, centerLon, existingRoutes } = body;

    const radiusDegrees = distance * 0.008;
    
    // Generate waypoints that form a rough circle around the start point
    const numWaypoints = 4;
    const waypoints: [number, number][] = [];
    
    for (let i = 1; i < numWaypoints; i++) {
      const angle = (i / numWaypoints) * 2 * Math.PI;
      const r = radiusDegrees * (0.7 + Math.random() * 0.6);
      const lat = centerLat + Math.sin(angle) * r;
      const lon = centerLon + Math.cos(angle) * r;
      waypoints.push([lon, lat]);
    }

    // If avoidFamiliar is false (want familiar routes), bias waypoints toward existing routes
    if (!avoidFamiliar && existingRoutes && existingRoutes.length > 0) {
      // Find center of existing routes and bias toward that area
      const allExistingCoords = existingRoutes.flatMap(r => r.coordinates);
      if (allExistingCoords.length > 0) {
        const avgLat = allExistingCoords.reduce((sum, c) => sum + c[1], 0) / allExistingCoords.length;
        const avgLon = allExistingCoords.reduce((sum, c) => sum + c[0], 0) / allExistingCoords.length;
        
        // Blend between center and start point based on how much familiarity we want
        const biasFactor = 0.3; // 30% toward existing routes area
        const centerAdjustedLat = centerLat * (1 - biasFactor) + avgLat * biasFactor;
        const centerAdjustedLon = centerLon * (1 - biasFactor) + avgLon * biasFactor;
        
        // Adjust waypoints toward the existing routes area
        waypoints.forEach((wp, i) => {
          const angle = (i / numWaypoints) * 2 * Math.PI;
          const r = radiusDegrees * (0.7 + Math.random() * 0.6);
          waypoints[i] = [
            centerAdjustedLon + Math.cos(angle) * r,
            centerAdjustedLat + Math.sin(angle) * r
          ];
        });
      }
    }

    const allCoords = [
      [centerLon, centerLat],
      ...waypoints,
      [centerLon, centerLat]
    ];

    const coordString = allCoords.map(c => `${c[0]},${c[1]}`).join(';');

    try {
      const response = await axios.get(
        `${OSRM_BASE}/route/v1/foot/${coordString}`,
        {
          params: {
            overview: 'full',
            geometries: 'geojson',
            steps: 'false',
            roundtrip: 'true',
            source: 'first',
            destination: 'first',
          },
          timeout: 20000,
        }
      );

      if (response.data.code !== 'Ok' || !response.data.routes || response.data.routes.length === 0) {
        throw new Error('Trip endpoint failed');
      }

      const route = response.data.routes[0];
      let coords = route.geometry.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]);
      
      // Calculate familiarity score
      const familiarity = existingRoutes ? calculateFamiliarity(coords, existingRoutes) : 0;
      
      // If avoidFamiliar but got too familiar, try to regenerate
      if (avoidFamiliar && existingRoutes && familiarity > 0.3 && existingRoutes.length > 0) {
        // Generate new waypoints that are further from existing routes
        const newWaypoints: [number, number][] = [];
        for (let i = 1; i < numWaypoints; i++) {
          const angle = (i / numWaypoints) * 2 * Math.PI + Math.random() * 0.5;
          const r = radiusDegrees * (1.0 + Math.random() * 0.5); // Further out
          const lat = centerLat + Math.sin(angle) * r;
          const lon = centerLon + Math.cos(angle) * r;
          newWaypoints.push([lon, lat]);
        }
        
        const newCoords = [
          [centerLon, centerLat],
          ...newWaypoints,
          [centerLon, centerLat]
        ];
        
        const newCoordString = newCoords.map(c => `${c[0]},${c[1]}`).join(';');
        
        try {
          const newResponse = await axios.get(
            `${OSRM_BASE}/route/v1/foot/${newCoordString}`,
            {
              params: {
                overview: 'full',
                geometries: 'geojson',
                steps: 'false',
                roundtrip: 'true',
              },
              timeout: 15000,
            }
          );
          
          if (newResponse.data.code === 'Ok' && newResponse.data.routes?.length > 0) {
            const newRoute = newResponse.data.routes[0];
            coords = newRoute.geometry.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]);
          }
        } catch (e) {
          // Keep original route
        }
      }

      const routeDistance = route.distance;
      const finalFamiliarity = existingRoutes ? calculateFamiliarity(coords, existingRoutes) : 0;
      const estimatedElevation = Math.round(distance * 10);

      const routeNames = [
        'Morning Loop', 'Evening Run', 'Park Circuit', 'Urban Loop',
        'Nature Trail', 'City Route', 'Sunset Run', 'Quick Loop',
        'Circular Path', 'Round Route', 'Discovery Trail', 'Exploration Run',
      ];
      const name = routeNames[Math.floor(Math.random() * routeNames.length)];

      return NextResponse.json({
        coordinates: coords,
        distance: routeDistance,
        elevationGain: estimatedElevation,
        name: `${name} - ${distance}km`,
        isRoundTrip: true,
        startPoint: [centerLon, centerLat] as [number, number],
        familiarityScore: Math.round(finalFamiliarity * 100),
      });

    } catch (tripError) {
      // Fallback
      const furthestWaypoint = waypoints[Math.floor(waypoints.length / 2)];
      
      const response = await axios.get(
        `${OSRM_BASE}/route/v1/foot/${centerLon},${centerLat};${furthestWaypoint[0]},${furthestWaypoint[1]};${centerLon},${centerLat}`,
        {
          params: {
            overview: 'full',
            geometries: 'geojson',
            steps: 'false',
          },
          timeout: 15000,
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
      const familiarity = existingRoutes ? calculateFamiliarity(coords, existingRoutes) : 0;
      const routeDistance = route.distance;
      const estimatedElevation = Math.round(distance * 10);

      const routeNames = ['Morning Loop', 'Evening Run', 'Park Circuit', 'Urban Loop'];
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
    }

  } catch (error: any) {
    console.error('Route suggestion error:', error.response?.data || error.message);
    
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return NextResponse.json(
        { error: 'Route service timed out. Please try again.' },
        { status: 504 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to generate route. Please try again.' },
      { status: 500 }
    );
  }
}