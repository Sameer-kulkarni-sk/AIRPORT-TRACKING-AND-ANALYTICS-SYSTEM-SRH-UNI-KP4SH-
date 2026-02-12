/**
 * API Client for fetching flight data from external sources
 * OpenSky Network and AviationStack
 */

const axios = require('../../node_modules/axios/index.d.cts');
require('dotenv').config();


require('dotenv').config();

class APIClient {
    constructor() {
        // this.aviationStackKey = process.env.AVIATIONSTACK_API_KEY || 'your_api_key_here'; // Add your API key
        // this.aviationStackBaseURL = 'http://api.aviationstack.com/v1';
        this.openSkyBaseURL = 'https://opensky-network.org/api';
        this.openSkyUsername = 'opensky_user'; // Replace with your OpenSky username if you have one
        this.openSkyPassword = 'opensky_pass'; // Replace with your OpenSky password if you have one

        // Airport configuration
        this.airportICAO = process.env.AIRPORT_ICAO || 'EDDF';
        this.airportLat = parseFloat(process.env.AIRPORT_LATITUDE || '50.0379');
        this.airportLon = parseFloat(process.env.AIRPORT_LONGITUDE || '8.5622');
        this.airportRadius = parseFloat(process.env.AIRPORT_ZONE_RADIUS_KM || '1000')
    }

    /**
     * Fetch live aircraft positions from OpenSky Network
     * Free API - no key required
     */
    async getOpenSkyFlights() {
        try {
            // Fetch ALL aircraft states globally and filter client-side
            // This avoids the issue where OpenSky returns null for empty bounding boxes
            const url = `${this.openSkyBaseURL}/states/all`;

            console.log('📡 Fetching all OpenSky aircraft states...');
            console.log(`📍 Airport: lat=${this.airportLat}, lon=${this.airportLon}, radius=${this.airportRadius}km`);
            
            const requestConfig = {
                timeout: 30000, // Increased timeout for global request
                headers: {
                    'User-Agent': 'AirportTrackingSystem/1.0'
                }
            };

            // Try with authentication first, fallback to anonymous if it fails
            let response;
            try {
                requestConfig.auth = {
                    username: this.openSkyUsername,
                    password: this.openSkyPassword
                };
                console.log('🔐 Using OpenSky authentication');
                response = await axios.get(url, requestConfig);
            } catch (authError) {
                console.log('⚠️  Authentication failed, trying anonymous access');
                delete requestConfig.auth;
                response = await axios.get(url, requestConfig);
            }

            console.log('📊 OpenSky response status:', response.status);
            console.log('📊 Total aircraft in response:', response.data?.states ? response.data.states.length : 0);

            if (!response.data || !response.data.states) {
                console.warn('⚠️  No states found in OpenSky response.');
                return [];
            }

            // Filter out null states and get only those within airport zone
            const validStates = response.data.states.filter(state => state !== null);
            console.log(`📊 Valid states after filtering nulls: ${validStates.length}`);
            
            if (validStates.length === 0) {
                console.warn('⚠️  No valid aircraft states in response');
                return [];
            }

            // Transform and filter to only include flights near airport
            const flights = validStates
                .map(state => ({
                    callsign: state[1] ? state[1].trim() : 'UNKNOWN',
                    origin_country: state[2],
                    longitude: state[5],
                    latitude: state[6],
                    altitude: state[7] ? state[7] * 3.28084 : 0, // Convert meters to feet
                    velocity: state[9] ? state[9] * 1.94384 : 0, // Convert m/s to knots
                    heading: state[10] || 0,
                    vertical_rate: state[11] || 0,
                    on_ground: state[8] || false,
                    last_contact: state[4],
                    timestamp: new Date().toISOString()
                }))
                .map((flight, index) => {
                    const distance = this.calculateDistance(
                        this.airportLat,
                        this.airportLon,
                        flight.latitude,
                        flight.longitude
                    );
                    return { ...flight, distance, index };
                });

            // Sort by distance to find closest flights
            flights.sort((a, b) => a.distance - b.distance);
            
            // Log closest flights regardless of radius
            console.log('🔍 Closest 5 flights to airport:');
            for (let i = 0; i < Math.min(5, flights.length); i++) {
                console.log(`  ${i + 1}. ${flights[i].callsign} at (${flights[i].latitude.toFixed(4)}, ${flights[i].longitude.toFixed(4)}) - Distance: ${flights[i].distance.toFixed(2)}km`);
            }

            // Filter to airport zone
            const nearbyFlights = flights.filter(f => f.distance <= this.airportRadius);

            console.log(`✅ Fetched ${nearbyFlights.length} flights within ${this.airportRadius}km of airport`);
            return nearbyFlights;
        } catch (error) {
            console.error('❌ OpenSky API error:', error.message);
            return [];
        }
    }

    /**
     * Fetch flight schedules from AviationStack
     * Requires API key
     */
    async getAviationStackFlights() {
        try {
            if (!this.aviationStackKey) {
                console.warn('⚠️  AviationStack API key not configured. Using sample data.');
                return this.generateSampleFlights();
            }

            const url = `${this.aviationStackBaseURL}/flights`;
            
            // Convert ICAO to IATA (e.g., EDDF -> FRA)
            const iataCode = this.getIATAFromICAO(this.airportICAO);
            
            const params = {
                access_key: this.aviationStackKey,
                dep_iata: iataCode,
                limit: 100
            };

            console.log(`📡 Fetching AviationStack data for airport: ${iataCode}...`);
            console.log(`📍 Request URL: ${url}`);
            console.log(`📍 Parameters:`, params);
            
            const response = await axios.get(url, {
                params,
                timeout: 10000
            });

            console.log('📊 AviationStack response status:', response.status);
            console.log('📊 Response data:', JSON.stringify(response.data, null, 2).substring(0, 500));

            if (!response.data) {
                console.warn('⚠️  No response data from AviationStack');
                return this.generateSampleFlights();
            }

            if (response.data.error) {
                console.error('❌ AviationStack error:', response.data.error);
                return this.generateSampleFlights();
            }

            if (!response.data.data || response.data.data.length === 0) {
                console.warn(`⚠️  No flights found for ${iataCode}. Using sample data.`);
                return this.generateSampleFlights();
            }

            // Transform AviationStack data
            const flights = response.data.data.map(flight => ({
                flightNumber: flight.flight.iata || flight.flight.icao,
                airline: flight.airline.name,
                airlineCode: flight.airline.iata,
                departure: {
                    airport: flight.departure.airport,
                    iata: flight.departure.iata,
                    scheduled: flight.departure.scheduled,
                    estimated: flight.departure.estimated,
                    actual: flight.departure.actual,
                    terminal: flight.departure.terminal,
                    gate: flight.departure.gate
                },
                arrival: {
                    airport: flight.arrival.airport,
                    iata: flight.arrival.iata,
                    scheduled: flight.arrival.scheduled,
                    estimated: flight.arrival.estimated,
                    actual: flight.arrival.actual,
                    terminal: flight.arrival.terminal,
                    gate: flight.arrival.gate
                },
                status: flight.flight_status,
                aircraft: {
                    registration: flight.aircraft?.registration,
                    iata: flight.aircraft?.iata,
                    icao: flight.aircraft?.icao
                }
            }));

            console.log(`✅ Fetched ${flights.length} flights from AviationStack`);
            return flights;
        } catch (error) {
            console.error('❌ AviationStack API error:', error.message);
            console.error('📋 Error details:', error.response?.data || error);
            console.log('📦 Using sample flight data instead...');
            return this.generateSampleFlights();
        }
    }

    /**
     * Convert ICAO code to IATA (common airport codes)
     */
    getIATAFromICAO(icao) {
        const iataMap = {
            'EDDF': 'FRA', // Frankfurt
            'KSFO': 'SFO', // San Francisco
            'KJFK': 'JFK', // New York JFK
            'KLAX': 'LAX', // Los Angeles
            'KORD': 'ORD', // Chicago
            'EGLL': 'LHR', // London Heathrow
            'LEMD': 'MAD', // Madrid
            'LFPG': 'CDG', // Paris Charles de Gaulle
            'LIRF': 'FCO'  // Rome Fiumicino
        };
        
        // If exact match not found, try generic conversion
        if (iataMap[icao.toUpperCase()]) {
            return iataMap[icao.toUpperCase()];
        }
        
        // Fallback: take last 3 characters (works for many airports)
        return icao.substring(1, 4).toUpperCase();
    }

    /**
     * Generate sample flight data for testing/demo purposes
     */
    generateSampleFlights() {
        return [
            {
                flightNumber: 'LH123',
                airline: 'Lufthansa',
                airlineCode: 'LH',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() + 3600000).toISOString(),
                    estimated: new Date(Date.now() + 3700000).toISOString(),
                    actual: null,
                    terminal: 'Terminal 1',
                    gate: 'A5'
                },
                arrival: {
                    airport: 'Berlin Brandenburg',
                    iata: 'BER',
                    scheduled: new Date(Date.now() + 5400000).toISOString(),
                    estimated: new Date(Date.now() + 5500000).toISOString(),
                    actual: null,
                    terminal: 'Terminal 1',
                    gate: 'B3'
                },
                status: 'scheduled',
                aircraft: {
                    registration: 'D-AIDE',
                    iata: 'A320',
                    icao: 'A320'
                }
            },
            {
                flightNumber: 'DL456',
                airline: 'Delta Air Lines',
                airlineCode: 'DL',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() + 7200000).toISOString(),
                    estimated: new Date(Date.now() + 7300000).toISOString(),
                    actual: null,
                    terminal: 'Terminal 2',
                    gate: 'C12'
                },
                arrival: {
                    airport: 'New York John F Kennedy',
                    iata: 'JFK',
                    scheduled: new Date(Date.now() + 36000000).toISOString(),
                    estimated: new Date(Date.now() + 36100000).toISOString(),
                    actual: null,
                    terminal: 'Terminal 4',
                    gate: 'A20'
                },
                status: 'scheduled',
                aircraft: {
                    registration: 'N123DA',
                    iata: 'A350',
                    icao: 'A350'
                }
            },
            {
                flightNumber: 'BA789',
                airline: 'British Airways',
                airlineCode: 'BA',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 600000).toISOString(),
                    estimated: new Date(Date.now() - 500000).toISOString(),
                    actual: new Date(Date.now() - 480000).toISOString(),
                    terminal: 'Terminal 3',
                    gate: 'E8'
                },
                arrival: {
                    airport: 'London Heathrow',
                    iata: 'LHR',
                    scheduled: new Date(Date.now() + 3600000).toISOString(),
                    estimated: new Date(Date.now() + 3500000).toISOString(),
                    actual: null,
                    terminal: 'Terminal 5',
                    gate: 'B15'
                },
                status: 'active',
                aircraft: {
                    registration: 'G-XWBA',
                    iata: 'B787',
                    icao: 'B787'
                }
            }
        ];
    }

    /**
     * Get combined flight data from both sources
     */
    async getAllFlights() {
        try {
            const [openSkyFlights, aviationStackFlights] = await Promise.all([
                this.getOpenSkyFlights(),
                this.getAviationStackFlights()
            ]);

            return {
                livePositions: openSkyFlights,
                schedules: aviationStackFlights,
                timestamp: new Date().toISOString(),
                totalLive: openSkyFlights.length,
                totalScheduled: aviationStackFlights.length
            };
        } catch (error) {
            console.error('❌ Error fetching flight data:', error);
            throw error;
        }
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRad(degrees) {
        return degrees * Math.PI / 180;
    }

    /**
     * Check if coordinates are within airport zone
     */
    isInAirportZone(lat, lon) {
        const distance = this.calculateDistance(
            this.airportLat,
            this.airportLon,
            lat,
            lon
        );
        return distance <= this.airportRadius;
    }

    /**
     * Calculate bounding boxes for efficient API queries
     * Divides large areas into smaller overlapping boxes to avoid API limits
     */
    calculateBoundingBoxes(centerLat, centerLon, radiusKm) {
        const boxes = [];
        const maxBoxSize = 500; // Maximum box size in km (OpenSky limit)

        if (radiusKm <= maxBoxSize) {
            // Single box is sufficient
            const box = this.createBoundingBox(centerLat, centerLon, radiusKm);
            boxes.push(box);
        } else {
            // Create multiple overlapping boxes
            const numBoxes = Math.ceil(radiusKm / maxBoxSize);
            const overlap = 50; // 50km overlap between boxes

            for (let i = 0; i < numBoxes; i++) {
                for (let j = 0; j < numBoxes; j++) {
                    const latOffset = (i - (numBoxes - 1) / 2) * (maxBoxSize - overlap);
                    const lonOffset = (j - (numBoxes - 1) / 2) * (maxBoxSize - overlap);

                    const boxLat = centerLat + (latOffset / 111.32); // Rough km to degrees conversion
                    const boxLon = centerLon + (lonOffset / (111.32 * Math.cos(this.toRad(centerLat))));

                    const box = this.createBoundingBox(boxLat, boxLon, maxBoxSize / 2);
                    boxes.push(box);
                }
            }
        }

        return boxes;
    }

    /**
     * Create a bounding box around a center point
     */
    createBoundingBox(centerLat, centerLon, halfSizeKm) {
        const latDelta = halfSizeKm / 111.32; // 1 degree lat ≈ 111.32 km
        const lonDelta = halfSizeKm / (111.32 * Math.cos(this.toRad(centerLat)));

        return {
            lamin: Math.max(-90, centerLat - latDelta),
            lomin: Math.max(-180, centerLon - lonDelta),
            lamax: Math.min(90, centerLat + latDelta),
            lomax: Math.min(180, centerLon + lonDelta)
        };
    }

    /**
     * Remove duplicate flights based on callsign and position proximity
     */
    removeDuplicateFlights(flights) {
        const unique = [];
        const seen = new Set();

        for (const flight of flights) {
            const key = `${flight.callsign}_${flight.latitude.toFixed(3)}_${flight.longitude.toFixed(3)}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(flight);
            }
        }

        return unique;
    }

    /**
     * Fetch all flights data from OpenSky /flights/all endpoint
     */
    async getAllFlightsData() {
        try {
            const url = `${this.openSkyBaseURL}/flights/all`;

            console.log('📡 Fetching all OpenSky flights data...');

            const requestConfig = {
                timeout: 30000,
                headers: {
                    'User-Agent': 'AirportTrackingSystem/1.0'
                }
            };

            // Try with authentication first
            let response;
            try {
                requestConfig.auth = {
                    username: this.openSkyUsername,
                    password: this.openSkyPassword
                };
                response = await axios.get(url, requestConfig);
            } catch (authError) {
                console.log('⚠️  Authentication failed, trying anonymous access');
                delete requestConfig.auth;
                response = await axios.get(url, requestConfig);
            }

            if (!response.data) {
                console.warn('⚠️  No flights data from OpenSky');
                return [];
            }

            console.log(`✅ Fetched ${response.data.length} flight records from /flights/all`);
            return response.data;
        } catch (error) {
            console.error('❌ OpenSky /flights/all API error:', error.message);
            return [];
        }
    }

    /**
     * Fetch flight tracks from OpenSky /tracks/all endpoint
     */
    async getTracks(icao24, time = 0) {
        try {
            const url = `${this.openSkyBaseURL}/tracks/all?icao24=${icao24}&time=${time}`;

            console.log(`📡 Fetching track for aircraft ${icao24}...`);

            const requestConfig = {
                timeout: 30000,
                headers: {
                    'User-Agent': 'AirportTrackingSystem/1.0'
                }
            };

            // Try with authentication first
            let response;
            try {
                requestConfig.auth = {
                    username: this.openSkyUsername,
                    password: this.openSkyPassword
                };
                response = await axios.get(url, requestConfig);
            } catch (authError) {
                console.log('⚠️  Authentication failed, trying anonymous access');
                delete requestConfig.auth;
                response = await axios.get(url, requestConfig);
            }

            if (!response.data) {
                console.warn(`⚠️  No track data for ${icao24}`);
                return null;
            }

            console.log(`✅ Fetched track data for ${icao24}`);
            return response.data;
        } catch (error) {
            console.error('❌ OpenSky /tracks/all API error:', error.message);
            return null;
        }
    }
}

module.exports = new APIClient();