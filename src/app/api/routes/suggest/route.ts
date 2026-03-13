import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

// Using OSRM (Open Source Routing Machine) - free, no API key needed
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
    const { distance, type, centerLat, centerLon } = body;

    // Convert km to meters for OSRM
    const targetDistanceMeters = distance * 1000;
    
    // Generate random start point within reasonable distance of center
    const radiusKm = 2;
    const startLat = centerLat + (Math.random() - 0.5) * (radiusKm / 111);
    const startLon = centerLon + (Math.random() - 0.5) * (radiusKm / 111);

    // Calculate approximate end point to get roughly the right distance
    const angle = Math.random() * 2 * Math.PI;
    const distanceRatio = 0.5 + Math.random() * 0.5;
    const endDistanceKm = distance * distanceRatio;
    
    const endLat = startLat + (Math.sin(angle) * endDistanceKm / 111);
    const endLon = startLon + (Math.cos(angle) * endDistanceKm / 111);

    // Use OSRM route API
    const profile = type === 'road' ? 'foot' : 'foot';
    
    const response = await axios.get(
      `${OSRM_BASE}/route/v1/${profile}/${startLon},${startLat};${endLon},${endLat}`,
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
        { error: 'No route found for these points. Try a different location.' },
        { status: 404 }
      );
    }

    const route = response.data.routes[0];
    const coords = route.geometry.coordinates.map((c: number[]) => [c[0], c[1]] as [number, number]);
    const routeDistance = route.distance;
    const routeElevation = 0; // OSRM doesn't provide elevation in basic response

    // Generate route name
    const routeNames = [
      'Morning Explorer',
      'Sunset Trail',
      'Urban Loop',
      'Nature Path',
      'City Runner',
      'Park Circuit',
      'Trail Blazer',
      'Road Runner',
    ];
    const name = routeNames[Math.floor(Math.random() * routeNames.length)];

    return NextResponse.json({
      coordinates: coords,
      distance: routeDistance,
      elevationGain: routeElevation,
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
      { error: 'Failed to generate route suggestion. Please try again.' },
      { status: 500 }
    );
  }
}
