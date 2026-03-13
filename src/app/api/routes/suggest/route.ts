import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const OSRM_BASE = 'https://router.project-osrm.org';

interface SuggestionRequest {
  distance: number; // km
  type: 'road' | 'trail' | 'mixed';
  centerLat: number;
  centerLon: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: SuggestionRequest = await request.json();
    const { distance, centerLat, centerLon } = body;

    const targetDistanceMeters = distance * 1000;
    
    // Generate random start point
    const radiusKm = 1.5;
    const startLat = centerLat + (Math.random() - 0.5) * (radiusKm / 111);
    const startLon = centerLon + (Math.random() - 0.5) * (radiusKm / 111);

    // Calculate waypoint that's roughly half the distance away (to create an out-and-back)
    const angle = Math.random() * 2 * Math.PI;
    const waypointDistanceKm = distance * 0.5;
    const waypointLat = startLat + (Math.sin(angle) * waypointDistanceKm / 111);
    const waypointLon = startLon + (Math.cos(angle) * waypointDistanceKm / 111);

    // Get route from start to waypoint
    const response = await axios.get(
      `${OSRM_BASE}/route/v1/foot/${startLon},${startLat};${waypointLon},${waypointLat}`,
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

    const outboundRoute = response.data.routes[0];
    const outboundCoords = outboundRoute.geometry.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]);
    const halfDistance = outboundRoute.distance;
    
    // Create loop by reversing and appending the route
    const returnCoords = [...outboundCoords].reverse();
    // Remove the last point (it's the same as the waypoint)
    returnCoords.pop();
    const fullCoords = [...outboundCoords, ...returnCoords];
    
    // Calculate actual total distance (there and back)
    const totalDistance = halfDistance * 2;
    
    // Estimate elevation gain (rough approximation: 10m per km for flat terrain)
    const estimatedElevation = Math.round(distance * 10);

    const routeNames = [
      'Morning Loop',
      'Evening Run',
      'Park Circuit',
      'Urban Loop',
      'Nature Trail',
      'City Route',
      'Sunset Run',
      'Quick Loop',
    ];
    const name = routeNames[Math.floor(Math.random() * routeNames.length)];

    return NextResponse.json({
      coordinates: fullCoords,
      distance: totalDistance,
      elevationGain: estimatedElevation,
      name: `${name} - ${distance}km`,
    });

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
