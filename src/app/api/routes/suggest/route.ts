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

    // Generate waypoints in a circle around the start point
    // Create 6-8 waypoints at different angles to form a circular route
    const numWaypoints = Math.max(6, Math.min(8, Math.ceil(distance / 3)));
    const radiusDegrees = distance * 0.007; // Approximate degrees based on distance
    
    const waypoints: [number, number][] = [];
    const angles: number[] = [];
    
    // Generate waypoints at different angles with slight randomization
    for (let i = 0; i < numWaypoints; i++) {
      const baseAngle = (i / numWaypoints) * 2 * Math.PI;
      const angleVariation = (Math.random() - 0.5) * 0.3; // ±0.15 rad variation
      const angle = baseAngle + angleVariation;
      angles.push(angle);
      
      // Vary radius to make it less perfectly circular (more natural)
      const radiusVariation = (Math.random() - 0.5) * 0.3;
      const radius = radiusDegrees * (0.8 + radiusVariation);
      
      const lat = centerLat + Math.sin(angle) * radius;
      const lon = centerLon + Math.cos(angle) * radius;
      waypoints.push([lon, lat]);
    }
    
    // If familiar mode, bias toward existing routes
    if (!avoidFamiliar && existingRoutes && existingRoutes.length > 0) {
      const allExistingCoords = existingRoutes.flatMap(r => r.coordinates);
      if (allExistingCoords.length > 0) {
        const avgLat = allExistingCoords.reduce((sum, c) => sum + c[1], 0) / allExistingCoords.length;
        const avgLon = allExistingCoords.reduce((sum, c) => sum + c[0], 0) / allExistingCoords.length;
        
        // Blend start point with existing routes area (30% toward existing, 70% toward selected point)
        const biasFactor = 0.3;
        const centerAdjustedLat = centerLat * (1 - biasFactor) + avgLat * biasFactor;
        const centerAdjustedLon = centerLon * (1 - biasFactor) + avgLon * biasFactor;
        
        // Regenerate waypoints around the biased center
        for (let i = 0; i < waypoints.length; i++) {
          const angle = angles[i];
          const radiusVariation = (Math.random() - 0.5) * 0.3;
          const radius = radiusDegrees * (0.7 + radiusVariation);
          
          waypoints[i] = [
            centerAdjustedLon + Math.cos(angle) * radius,
            centerAdjustedLat + Math.sin(angle) * radius
          ];
        }
      }
    }
    
    // Build coordinate string: start -> waypoint1 -> ... -> waypointN -> start
    const allCoords = [
      [centerLon, centerLat],
      ...waypoints
    ];
    
    const coordString = allCoords.map(c => `${c[0]},${c[1]}`).join(';');
    
    try {
      // Use OSRM route endpoint with all waypoints for a circular route
      const response = await axios.get(
        `${OSRM_BASE}/route/v1/foot/${coordString}`,
        {
          params: {
            overview: 'full',
            geometries: 'geojson',
            steps: 'false',
          },
          timeout: 25000,
        }
      );

      if (response.data.code !== 'Ok' || !response.data.routes || response.data.routes.length === 0) {
        throw new Error('Route generation failed');
      }

      const route = response.data.routes[0];
      let coords = route.geometry.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]);
      
      // Calculate familiarity
      const familiarity = existingRoutes ? calculateFamiliarity(coords, existingRoutes) : 0;
      
      // If avoiding familiar paths and got too familiar, try regenerating with different waypoints
      if (avoidFamiliar && existingRoutes && familiarity > 0.25 && existingRoutes.length > 0) {
        // Generate waypoints further from center
        const newWaypoints: [number, number][] = [];
        for (let i = 0; i < numWaypoints; i++) {
          const angle = (i / numWaypoints) * 2 * Math.PI + (Math.random() * 0.5);
          const radius = radiusDegrees * (1.1 + Math.random() * 0.4); // Further out
          const lat = centerLat + Math.sin(angle) * radius;
          const lon = centerLon + Math.cos(angle) * radius;
          newWaypoints.push([lon, lat]);
        }
        
        const newCoords = [[centerLon, centerLat], ...newWaypoints];
        const newCoordString = newCoords.map(c => `${c[0]},${c[1]}`).join(';');
        
        try {
          const newResponse = await axios.get(
            `${OSRM_BASE}/route/v1/foot/${newCoordString}`,
            {
              params: {
                overview: 'full',
                geometries: 'geojson',
                steps: 'false',
              },
              timeout: 20000,
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
        'Figure Eight', 'Neighborhood Loop', 'Scenic Loop',
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

    } catch (error: any) {
      console.error('Route generation error:', error.message);
      return NextResponse.json(
        { error: 'Failed to generate circular route. Try adjusting the distance or location.' },
        { status: 500 }
      );
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