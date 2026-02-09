/**
 * API Client for fetching flight data from external sources
 * OpenSky Network and AviationStack
 */

const axios = require('axios');
require('dotenv').config();


require('dotenv').config();

class APIClient {
    constructor() {
        // this.aviationStackKey = process.env.AVIATIONSTACK_API_KEY;
        // this.aviationStackBaseURL = 'http://api.aviationstack.com/v1';
        this.openSkyBaseURL = 'https://opensky-network.org/api';
        this.openSkyUsername = 'FAH';
        this.openSkyPassword = 'TL]M2{C632Z+';
        this.aviationStackKey = process.env.AVIATIONSTACK_API_KEY;
        this.aviationStackBaseURL = 'http://api.aviationstack.com/v1';

        // Multiple flight data sources
        this.openSkyBaseURL = 'https://opensky-network.org/api';
        this.adsbLolBaseURL = 'https://api.adsb.lol/v2';

        // OpenSky credentials (Basic Auth - username/password for higher rate limits)
        this.openSkyUsername = process.env.OPENSKY_USERNAME;
        this.openSkyPassword = process.env.OPENSKY_PASSWORD;

        // Data source preference (adsb.lol is unlimited, use it first)
        this.useAdsbLol = process.env.USE_ADSB_LOL !== 'false'; // Default to true

        // Airport configuration
        this.airportICAO = process.env.AIRPORT_ICAO || 'EDDF';
        this.airportLat = parseFloat(process.env.AIRPORT_LATITUDE || '50.0379');
        this.airportLon = parseFloat(process.env.AIRPORT_LONGITUDE || '8.5622');
        this.airportRadius = parseFloat(process.env.AIRPORT_ZONE_RADIUS_KM || '50');
        this.airportRadius = parseFloat(process.env.AIRPORT_ZONE_RADIUS_KM || '10');

        // Rate limiting with retry-after support (for OpenSky fallback)
        this.lastOpenSkyCall = 0;
        this.openSkyMinInterval = 10000; // Minimum 10 seconds between calls
        this.openSkyRetryAfter = 0; // Timestamp when we can retry after 429
        this.openSkyDisabledUntil = 0; // Disable OpenSky temporarily after repeated failures
    }

    /**
     * Check if OpenSky credentials are configured
     */
    hasOpenSkyCredentials() {
        return !!(this.openSkyUsername && this.openSkyPassword);
    }

    /**
     * Fetch live aircraft positions from ADSB.lol
     * Unlimited API - no authentication required
     */
    async getAdsbLolFlights() {
        try {
            // ADSB.lol API v2 uses point/radius format
            // Radius is in nautical miles, convert from km
            const radiusNM = this.airportRadius * 0.539957;

            // Try multiple endpoints for better coverage
            const endpoints = [
                `${this.adsbLolBaseURL}/point/${this.airportLat}/${this.airportLon}/${radiusNM}`,
                `${this.adsbLolBaseURL}/lat/${this.airportLat}/lon/${this.airportLon}/dist/${radiusNM}`
            ];

            console.log(`📡 Fetching ADSB.lol data (${radiusNM.toFixed(1)}nm / ${this.airportRadius}km radius)...`);
            console.log(`📍 Search area: Frankfurt (${this.airportLat}, ${this.airportLon})`);

            let response = null;
            let usedEndpoint = '';

            // Try each endpoint
            for (const url of endpoints) {
                try {
                    response = await axios.get(url, {
                        timeout: 15000,
                        headers: {
                            'User-Agent': 'AirportTrackingSystem/1.0',
                            'Accept': 'application/json'
                        }
                    });
                    usedEndpoint = url;
                    console.log(`✅ ADSB.lol endpoint responded: ${url.split('/v2/')[1]}`);
                    break;
                } catch (err) {
                    console.log(`⚠️  Endpoint failed: ${url.split('/v2/')[1]} - ${err.message}`);
                    continue;
                }
            }

            if (!response) {
                console.error('❌ All ADSB.lol endpoints failed');
                return [];
            }

            // ADSB.lol returns array of aircraft directly or in 'ac' property
            const aircraftData = Array.isArray(response.data) ? response.data : (response.data.ac || []);

            console.log(`📊 ADSB.lol raw response: ${aircraftData.length} aircraft`);

            if (!aircraftData || aircraftData.length === 0) {
                console.log('⚠️  ADSB.lol returned no aircraft in range');
                console.log('💡 Tip: Try increasing AIRPORT_ZONE_RADIUS_KM in .env or check if there are flights in the area');
                return [];
            }

            // Transform ADSB.lol data format to match OpenSky format
            const flights = aircraftData
                .filter(aircraft => {
                    if (!aircraft.lat || !aircraft.lon) {
                        return false;
                    }
                    // Additional validation
                    if (Math.abs(aircraft.lat) > 90 || Math.abs(aircraft.lon) > 180) {
                        return false;
                    }
                    return true;
                })
                .map(aircraft => ({
                    callsign: aircraft.flight ? aircraft.flight.trim() : aircraft.r || aircraft.hex || 'UNKNOWN',
                    origin_country: aircraft.flag || 'Unknown',
                    longitude: aircraft.lon,
                    latitude: aircraft.lat,
                    altitude: aircraft.alt_baro ? aircraft.alt_baro * 3.28084 : (aircraft.alt_geom ? aircraft.alt_geom * 3.28084 : 0), // Convert meters to feet
                    velocity: aircraft.gs || 0, // Ground speed in knots
                    heading: aircraft.track || aircraft.true_heading || 0,
                    vertical_rate: aircraft.baro_rate ? aircraft.baro_rate * 196.85 : 0, // Convert m/s to ft/min
                    on_ground: aircraft.alt_baro < 100 || aircraft.alt_geom < 100 || false,
                    last_contact: aircraft.seen || 0,
                    timestamp: new Date().toISOString()
                }));

            console.log(`✅ Fetched ${flights.length} valid flights from ADSB.lol (unlimited)`);

            if (flights.length > 0) {
                console.log(`📍 Sample flight: ${flights[0].callsign} at ${flights[0].altitude.toFixed(0)}ft`);
            }

            return flights;
        } catch (error) {
            if (error.response) {
                console.error(`❌ ADSB.lol API error (${error.response.status}):`, error.response.statusText);
                console.error(`📄 Response data:`, JSON.stringify(error.response.data).substring(0, 200));
            } else if (error.request) {
                console.error('❌ ADSB.lol API error: No response received');
            } else {
                console.error('❌ ADSB.lol API error:', error.message);
            }
            return [];
        }
    }

    /**
     * Fetch live aircraft positions from OpenSky Network (fallback)
     * Free API - with rate limits
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
            const now = Date.now();

            // Check if OpenSky is temporarily disabled
            if (now < this.openSkyDisabledUntil) {
                const waitSeconds = Math.ceil((this.openSkyDisabledUntil - now) / 1000);
                console.log(`⏸️  OpenSky disabled for ${waitSeconds}s (rate limit recovery)`);
                return [];
            }

            // Check if we need to wait for retry-after
            if (now < this.openSkyRetryAfter) {
                const waitSeconds = Math.ceil((this.openSkyRetryAfter - now) / 1000);
                console.log(`⏳ OpenSky retry-after: waiting ${waitSeconds}s`);
                return [];
            }

            // Check minimum interval between calls
            if (now - this.lastOpenSkyCall < this.openSkyMinInterval) {
                console.log('⏳ OpenSky rate limit: minimum interval not met');
                return [];
            }

            // Calculate bounding box around airport
            const latDelta = this.airportRadius / 111; // 1 degree lat ≈ 111 km
            const lonDelta = this.airportRadius / (111 * Math.cos(this.airportLat * Math.PI / 180));

            const lamin = this.airportLat - latDelta;
            const lamax = this.airportLat + latDelta;
            const lomin = this.airportLon - lonDelta;
            const lomax = this.airportLon + lonDelta;

            const url = `${this.openSkyBaseURL}/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

            console.log('📡 Fetching OpenSky data...');

            // Build request config
            const config = {
                timeout: 15000,
                headers: {
                    'User-Agent': 'AirportTrackingSystem/1.0'
                }
            };

            // Add authentication only if credentials are provided
            if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD) {
                requestConfig.auth = {
                    // username: process.env.OPENSKY_USERNAME,
                    // password: process.env.OPENSKY_PASSWORD
                    username: this.openSkyUsername,
                    password: this.openSkyPassword
                };
                console.log('🔐 Using authentication');
            }

            const response = await axios.get(url, requestConfig);

            console.log('📊 OpenSky response status:', response.status);
            console.log('📊 Total aircraft in response:', response.data?.states ? response.data.states.length : 0);
            // Use Basic Auth if credentials are available (higher rate limits)
            if (this.hasOpenSkyCredentials()) {
                config.auth = {
                    username: this.openSkyUsername,
                    password: this.openSkyPassword
                };
                console.log('🔐 Using OpenSky authenticated access');
            } else {
                console.log('📡 Using OpenSky anonymous access (limited rate)');
            }

            const response = await axios.get(url, config);
            this.lastOpenSkyCall = now; // Update last call time

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

            // Filter to airport zone - temporarily increased to 200km for testing
            const nearbyFlights = flights.filter(f => f.distance <= 200);
            
            console.log(`✅ Fetched ${nearbyFlights.length} flights within 200km of airport`);
            return nearbyFlights;
            console.log(`✅ Fetched ${flights.length} flights from OpenSky`);

            // Log rate limit info if available
            if (response.headers['x-rate-limit-remaining']) {
                console.log(`📊 OpenSky credits remaining: ${response.headers['x-rate-limit-remaining']}`);
            }

            return flights;
        } catch (error) {
            // Handle 429 rate limit error with retry-after
            if (error.response && error.response.status === 429) {
                const retryAfterSeconds = parseInt(error.response.headers['x-rate-limit-retry-after-seconds'] || '60');
                this.openSkyRetryAfter = Date.now() + (retryAfterSeconds * 1000);

                console.error(`❌ OpenSky rate limit (429): Retry after ${retryAfterSeconds}s`);
                console.log(`⏰ Next OpenSky attempt at: ${new Date(this.openSkyRetryAfter).toLocaleTimeString()}`);

                // If retry-after is very long, disable for a while
                if (retryAfterSeconds > 300) { // More than 5 minutes
                    this.openSkyDisabledUntil = this.openSkyRetryAfter;
                    console.log(`⏸️  OpenSky temporarily disabled for ${Math.ceil(retryAfterSeconds / 60)} minutes`);
                }
            } else {
                console.error('❌ OpenSky API error:', error.message);
            }

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

            // Map ICAO to IATA codes
            const icaoToIata = {
                'EDDF': 'FRA',  // Frankfurt
                'KJFK': 'JFK',  // New York JFK
                'EGLL': 'LHR',  // London Heathrow
                'LFPG': 'CDG',  // Paris Charles de Gaulle
                'EHAM': 'AMS',  // Amsterdam
                'LEMD': 'MAD',  // Madrid
                'LIRF': 'FCO',  // Rome Fiumicino
            };

            const iataCode = icaoToIata[this.airportICAO] || 'FRA';

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
     * Get combined flight data from all sources
     */
    async getAllFlights() {
        try {
            let livePositions = [];

            // Try ADSB.lol first (unlimited, no auth)
            if (this.useAdsbLol) {
                livePositions = await this.getAdsbLolFlights();

                // If ADSB.lol fails or returns no data, fallback to OpenSky
                if (livePositions.length === 0) {
                    console.log('⚠️  ADSB.lol returned no data, trying OpenSky...');
                    livePositions = await this.getOpenSkyFlights();
                }
            } else {
                // Use OpenSky if ADSB.lol is disabled
                livePositions = await this.getOpenSkyFlights();
            }

            // Get schedules from AviationStack
            const aviationStackFlights = await this.getAviationStackFlights();

            return {
                livePositions: livePositions,
                schedules: aviationStackFlights,
                timestamp: new Date().toISOString(),
                totalLive: livePositions.length,
                totalScheduled: aviationStackFlights.length,
                source: livePositions.length > 0 ? (this.useAdsbLol ? 'ADSB.lol' : 'OpenSky') : 'None'
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
}

module.exports = new APIClient();