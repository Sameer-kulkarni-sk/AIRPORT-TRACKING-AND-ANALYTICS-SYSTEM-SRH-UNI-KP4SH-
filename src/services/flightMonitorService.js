/**
 * Flight Monitor Service - Use Case 1
 * Team Member: Sameer Kulkarni
 * 
 * Monitors live flights and gate status
 * Combines data from Redis (live status), Neo4j (gate assignments), and MongoDB (schedules)
 */

const dbManager = require('../config/database');
const apiClient = require('../utils/apiclient');

class FlightMonitorService {
    constructor() {
        this.updateInterval = null;
    }

    /**
     * Start continuous monitoring of flights
     */
    startMonitoring() {
        const interval = parseInt(process.env.FLIGHT_DATA_REFRESH_INTERVAL || '10') * 1000;

        console.log(`🔄 Starting flight monitoring (refresh every ${interval / 1000}s)`);

        // Initial fetch
        this.updateFlightData();

        // Set up periodic updates
        this.updateInterval = setInterval(() => {
            this.updateFlightData();
        }, interval);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            console.log('⏹️  Flight monitoring stopped');
        }
    }

    /**
     * Fetch and update flight data from APIs
     */
    async updateFlightData() {
        try {
            console.log('📡 Updating flight data...');

            // Get data from APIs
            const flightData = await apiClient.getAllFlights();

            // Store live positions in Redis
            await this.storeLivePositions(flightData.livePositions);

            // Store schedules in MongoDB
            await this.storeSchedules(flightData.schedules);

            console.log(`✅ Updated ${flightData.totalLive} live positions, ${flightData.totalScheduled} schedules`);
        } catch (error) {
            console.error('❌ Error updating flight data:', error.message);
        }
    }

    /**
     * Store live aircraft positions in Redis
     */
    async storeLivePositions(positions) {
        const redis = dbManager.getRedis();

        for (const aircraft of positions) {
            const key = `aircraft:${aircraft.callsign}:position`;

            // Store as hash
            await redis.hSet(key, {
                callsign: aircraft.callsign,
                latitude: aircraft.latitude.toString(),
                longitude: aircraft.longitude.toString(),
                altitude: aircraft.altitude.toString(),
                velocity: aircraft.velocity.toString(),
                heading: aircraft.heading.toString(),
                on_ground: aircraft.on_ground.toString(),
                last_update: aircraft.timestamp
            });

            // Set expiration (5 minutes)
            await redis.expire(key, 300);
        }
    }

    /**
     * Store flight schedules in MongoDB
     */
    async storeSchedules(schedules) {
        if (schedules.length === 0) return;

        const db = dbManager.getMongoDB();
        const collection = db.collection('flight_schedules');

        // Upsert schedules
        const operations = schedules.map(flight => ({
            updateOne: {
                filter: { flightNumber: flight.flightNumber },
                update: {
                    $set: {
                        ...flight,
                        lastUpdated: new Date()
                    }
                },
                upsert: true
            }
        }));

        if (operations.length > 0) {
            await collection.bulkWrite(operations);
        }
    }

    /**
     * Get all live flights with complete information
     * Combines OpenSky live positions with AviationStack schedule data
     */
    async getLiveFlights() {
        try {
            console.log('📡 Fetching combined flight data from OpenSky and AviationStack...');

            // Fetch both live positions and schedules simultaneously
            const [openSkyFlights, aviationStackFlights] = await Promise.all([
                apiClient.getOpenSkyFlights(),
                apiClient.getAviationStackFlights()
            ]);

            console.log(`📊 OpenSky flights: ${openSkyFlights.length}, AviationStack schedules: ${aviationStackFlights.length}`);

            // Create schedule map for enrichment - combine API data with sample schedules
            const scheduleMap = {};

            // Add API schedules first
            for (const schedule of aviationStackFlights) {
                const flightNumber = schedule.flightNumber;
                if (flightNumber) {
                    scheduleMap[flightNumber] = schedule;
                }
            }

            // Add sample schedules for common callsigns seen in live data
            const sampleSchedules = this.generateSampleSchedules();
            for (const schedule of sampleSchedules) {
                const flightNumber = schedule.flightNumber;
                if (flightNumber && !scheduleMap[flightNumber]) {
                    scheduleMap[flightNumber] = schedule;
                }
            }

            // Store live positions in Redis for collision detection
            try {
                await this.storeLivePositions(openSkyFlights);
            } catch (err) {
                console.log('ℹ️  Could not store positions to Redis:', err.message);
            }

            // Store schedules in MongoDB
            try {
                await this.storeSchedules(aviationStackFlights);
            } catch (err) {
                console.log('ℹ️  Could not store schedules to MongoDB:', err.message);
            }

            // Enrich OpenSky flights with AviationStack schedule data
            const enrichedFlights = openSkyFlights.map(flight => {
                // Try to match by callsign first
                let schedule = scheduleMap[flight.callsign];

                // If no direct match, try to find by partial callsign or registration
                if (!schedule) {
                    for (const [flightNum, sched] of Object.entries(scheduleMap)) {
                        if (flightNum.includes(flight.callsign.substring(0, 2)) ||
                            sched.aircraft?.registration === flight.callsign) {
                            schedule = sched;
                            break;
                        }
                    }
                }

                // If still no match, create a basic schedule from the callsign
                if (!schedule) {
                    schedule = {
                        flightNumber: flight.callsign,
                        airline: 'Unknown Airline',
                        airlineCode: 'UNK',
                        departure: {
                            airport: 'Unknown Airport',
                            iata: 'N/A',
                            scheduled: null,
                            estimated: null,
                            actual: null,
                            terminal: 'N/A',
                            gate: 'N/A'
                        },
                        arrival: {
                            airport: 'Unknown Airport',
                            iata: 'N/A',
                            scheduled: null,
                            estimated: null,
                            actual: null,
                            terminal: 'N/A',
                            gate: 'N/A'
                        },
                        status: 'in-flight',
                        aircraft: {
                            registration: flight.callsign,
                            iata: 'UNK',
                            icao: 'UNK'
                        }
                    };
                }

                return {
                    callsign: flight.callsign,
                    origin_country: flight.origin_country || 'Unknown',
                    position: {
                        latitude: flight.latitude || 0,
                        longitude: flight.longitude || 0,
                        altitude: flight.altitude || 0,
                        velocity: flight.velocity || 0,
                        heading: flight.heading || 0
                    },
                    latitude: flight.latitude || 0,
                    longitude: flight.longitude || 0,
                    altitude: flight.altitude || 0,
                    velocity: flight.velocity || 0,
                    heading: flight.heading || 0,
                    on_ground: flight.on_ground || false,
                    gate: schedule?.departure?.gate || 'N/A',
                    terminal: schedule?.departure?.terminal || 'N/A',
                    status: this.determineStatusFromOpenSky(flight),
                    schedule: schedule || {
                        flightNumber: flight.callsign,
                        airline: 'Unknown',
                        aircraftType: 'Unknown',
                        aircraft: {},
                        departure: { airport: 'Unknown', iata: 'N/A' },
                        arrival: { airport: 'Unknown', iata: 'N/A' }
                    },
                    last_update: flight.timestamp || new Date().toISOString()
                };
            });

            console.log(`✅ Enriched ${enrichedFlights.length} flights with schedule data`);
            return enrichedFlights;

        } catch (error) {
            console.error('Error getting live flights:', error.message);
            return this.generateSampleFlights();
        }
    }

    /**
     * Determine flight status based on OpenSky data
     */
    determineStatusFromOpenSky(flight) {
        if (flight.on_ground) {
            return 'on-ground';
        }
        if (flight.altitude < 1000) {
            return 'taxiing';
        }
        if (flight.altitude > 5000) {
            return 'in-flight';
        }
        return 'climbing';
    }

    /**
     * Generate sample schedules for enrichment
     */
    generateSampleSchedules() {
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
                    terminal: 'Terminal 1',
                    gate: 'A5'
                },
                arrival: {
                    airport: 'Berlin Brandenburg',
                    iata: 'BER',
                    scheduled: new Date(Date.now() + 5400000).toISOString(),
                    estimated: new Date(Date.now() + 5500000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'B3'
                },
                status: 'active',
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
                    scheduled: new Date(Date.now() - 3600000).toISOString(),
                    actual: new Date(Date.now() - 3300000).toISOString(),
                    terminal: 'Terminal 2',
                    gate: 'C12'
                },
                arrival: {
                    airport: 'New York John F Kennedy',
                    iata: 'JFK',
                    scheduled: new Date(Date.now() + 32400000).toISOString(),
                    estimated: new Date(Date.now() + 32300000).toISOString(),
                    terminal: 'Terminal 4',
                    gate: 'A20'
                },
                status: 'active',
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
                    scheduled: new Date(Date.now() - 1800000).toISOString(),
                    actual: new Date(Date.now() - 1500000).toISOString(),
                    terminal: 'Terminal 3',
                    gate: 'E8'
                },
                arrival: {
                    airport: 'London Heathrow',
                    iata: 'LHR',
                    scheduled: new Date(Date.now() + 3600000).toISOString(),
                    estimated: new Date(Date.now() + 3500000).toISOString(),
                    terminal: 'Terminal 5',
                    gate: 'B15'
                },
                status: 'active',
                aircraft: {
                    registration: 'G-XWBA',
                    iata: 'B787',
                    icao: 'B787'
                }
            },
            // Add schedules for common callsigns seen in live data
            {
                flightNumber: 'GFA006',
                airline: 'Gulf Air',
                airlineCode: 'GF',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 1200000).toISOString(),
                    actual: new Date(Date.now() - 900000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'B22'
                },
                arrival: {
                    airport: 'Bahrain International',
                    iata: 'BAH',
                    scheduled: new Date(Date.now() + 25200000).toISOString(),
                    estimated: new Date(Date.now() + 25000000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'A15'
                },
                status: 'active',
                aircraft: {
                    registration: 'A9C-??',
                    iata: 'A320',
                    icao: 'A320'
                }
            },
            {
                flightNumber: 'EZY84EL',
                airline: 'EasyJet',
                airlineCode: 'U2',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 900000).toISOString(),
                    actual: new Date(Date.now() - 600000).toISOString(),
                    terminal: 'Terminal 2',
                    gate: 'D45'
                },
                arrival: {
                    airport: 'London Gatwick',
                    iata: 'LGW',
                    scheduled: new Date(Date.now() + 7200000).toISOString(),
                    estimated: new Date(Date.now() + 7000000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'B12'
                },
                status: 'active',
                aircraft: {
                    registration: 'G-EZ??',
                    iata: 'A319',
                    icao: 'A319'
                }
            },
            {
                flightNumber: 'UAE42',
                airline: 'Emirates',
                airlineCode: 'EK',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 1800000).toISOString(),
                    actual: new Date(Date.now() - 1500000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'A10'
                },
                arrival: {
                    airport: 'Dubai International',
                    iata: 'DXB',
                    scheduled: new Date(Date.now() + 28800000).toISOString(),
                    estimated: new Date(Date.now() + 28600000).toISOString(),
                    terminal: 'Terminal 3',
                    gate: 'A5'
                },
                status: 'active',
                aircraft: {
                    registration: 'A6-E??',
                    iata: 'A380',
                    icao: 'A380'
                }
            },
            {
                flightNumber: 'THY7MF',
                airline: 'Turkish Airlines',
                airlineCode: 'TK',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 2400000).toISOString(),
                    actual: new Date(Date.now() - 2100000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'B18'
                },
                arrival: {
                    airport: 'Istanbul Airport',
                    iata: 'IST',
                    scheduled: new Date(Date.now() + 14400000).toISOString(),
                    estimated: new Date(Date.now() + 14200000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'A22'
                },
                status: 'active',
                aircraft: {
                    registration: 'TC-J??',
                    iata: 'B777',
                    icao: 'B777'
                }
            },
            {
                flightNumber: 'BCS39G',
                airline: 'European Air Transport',
                airlineCode: 'BCS',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 300000).toISOString(),
                    actual: new Date(Date.now() - 100000).toISOString(),
                    terminal: 'Terminal 2',
                    gate: 'C8'
                },
                arrival: {
                    airport: 'Leipzig Halle',
                    iata: 'LEJ',
                    scheduled: new Date(Date.now() + 3600000).toISOString(),
                    estimated: new Date(Date.now() + 3400000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'A3'
                },
                status: 'active',
                aircraft: {
                    registration: 'D-AT??',
                    iata: 'AT75',
                    icao: 'AT75'
                }
            },
            // Additional schedules for live callsigns seen in data
            {
                flightNumber: 'AIC2016',
                airline: 'Air India Cargo',
                airlineCode: 'AIC',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 1800000).toISOString(),
                    actual: new Date(Date.now() - 1500000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'B10'
                },
                arrival: {
                    airport: 'Delhi Indira Gandhi',
                    iata: 'DEL',
                    scheduled: new Date(Date.now() + 43200000).toISOString(),
                    estimated: new Date(Date.now() + 43000000).toISOString(),
                    terminal: 'Terminal 3',
                    gate: 'D12'
                },
                status: 'active',
                aircraft: {
                    registration: 'VT-??',
                    iata: 'B777',
                    icao: 'B777'
                }
            },
            {
                flightNumber: 'BCS9TC',
                airline: 'European Air Transport',
                airlineCode: 'BCS',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 600000).toISOString(),
                    actual: new Date(Date.now() - 300000).toISOString(),
                    terminal: 'Terminal 2',
                    gate: 'C15'
                },
                arrival: {
                    airport: 'Cologne Bonn',
                    iata: 'CGN',
                    scheduled: new Date(Date.now() + 1800000).toISOString(),
                    estimated: new Date(Date.now() + 1600000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'B5'
                },
                status: 'active',
                aircraft: {
                    registration: 'D-AT??',
                    iata: 'AT75',
                    icao: 'AT75'
                }
            },
            {
                flightNumber: 'MBU8TN',
                airline: 'CargoLogic Germany',
                airlineCode: 'MBU',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 900000).toISOString(),
                    actual: new Date(Date.now() - 600000).toISOString(),
                    terminal: 'Terminal 2',
                    gate: 'D20'
                },
                arrival: {
                    airport: 'East Midlands',
                    iata: 'EMA',
                    scheduled: new Date(Date.now() + 7200000).toISOString(),
                    estimated: new Date(Date.now() + 7000000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'A8'
                },
                status: 'active',
                aircraft: {
                    registration: 'D-A??',
                    iata: 'B757',
                    icao: 'B757'
                }
            },
            {
                flightNumber: 'FDX4293',
                airline: 'FedEx Express',
                airlineCode: 'FDX',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 1200000).toISOString(),
                    actual: new Date(Date.now() - 900000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'A25'
                },
                arrival: {
                    airport: 'Paris Charles de Gaulle',
                    iata: 'CDG',
                    scheduled: new Date(Date.now() + 5400000).toISOString(),
                    estimated: new Date(Date.now() + 5200000).toISOString(),
                    terminal: 'Terminal 2F',
                    gate: 'K12'
                },
                status: 'active',
                aircraft: {
                    registration: 'N4??',
                    iata: 'B777',
                    icao: 'B777'
                }
            },
            {
                flightNumber: 'MPH9172',
                airline: 'Martinair Cargo',
                airlineCode: 'MPH',
                departure: {
                    airport: 'Frankfurt am Main',
                    iata: 'FRA',
                    scheduled: new Date(Date.now() - 1500000).toISOString(),
                    actual: new Date(Date.now() - 1200000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'B30'
                },
                arrival: {
                    airport: 'Amsterdam Schiphol',
                    iata: 'AMS',
                    scheduled: new Date(Date.now() + 3600000).toISOString(),
                    estimated: new Date(Date.now() + 3400000).toISOString(),
                    terminal: 'Terminal 1',
                    gate: 'D18'
                },
                status: 'active',
                aircraft: {
                    registration: 'PH-M??',
                    iata: 'B747',
                    icao: 'B747'
                }
            }
        ];
    }

    /**
     * Generate sample flights for demo/testing
     */
    generateSampleFlights() {
        return [
            {
                callsign: 'LH123',
                position: {
                    latitude: 50.0379,
                    longitude: 8.5622,
                    altitude: 8000,
                    velocity: 180,
                    heading: 90
                },
                latitude: 50.0379,
                longitude: 8.5622,
                altitude: 8000,
                velocity: 180,
                heading: 90,
                on_ground: false,
                gate: 'A5',
                terminal: 'Terminal 1',
                status: 'taxiing',
                schedule: {
                    flightNumber: 'LH123',
                    airline: 'Lufthansa',
                    airlineCode: 'LH',
                    departure: {
                        airport: 'Frankfurt am Main',
                        iata: 'FRA',
                        scheduled: new Date(Date.now() + 3600000).toISOString(),
                        estimated: new Date(Date.now() + 3700000).toISOString(),
                        terminal: 'Terminal 1',
                        gate: 'A5'
                    },
                    arrival: {
                        airport: 'Berlin Brandenburg',
                        iata: 'BER',
                        scheduled: new Date(Date.now() + 5400000).toISOString(),
                        estimated: new Date(Date.now() + 5500000).toISOString(),
                        terminal: 'Terminal 1',
                        gate: 'B3'
                    },
                    status: 'active',
                    aircraft: {
                        registration: 'D-AIDE',
                        iata: 'A320',
                        icao: 'A320'
                    }
                },
                last_update: new Date().toISOString()
            }
        ];
    }

    /**
     * Get gate assignment from Neo4j
     */
    async getGateAssignment(callsign) {
        try {
            const driver = dbManager.getNeo4j();
            const session = driver.session();

            const result = await session.run(`
        MATCH (f:Flight {callsign: $callsign})-[:ASSIGNED_TO]->(g:Gate)-[:BELONGS_TO]->(t:Terminal)
        RETURN g.gateNumber as gate, t.terminalName as terminal
      `, { callsign });

            await session.close();

            if (result.records.length > 0) {
                return {
                    gate: result.records[0].get('gate'),
                    terminal: result.records[0].get('terminal')
                };
            }

            return null;
        } catch (error) {
            console.error('Error getting gate assignment:', error);
            return null;
        }
    }

    /**
     * Get flight schedule from MongoDB
     */
    async getFlightSchedule(callsign) {
        try {
            const db = dbManager.getMongoDB();
            const collection = db.collection('flight_schedules');

            const schedule = await collection.findOne({
                $or: [
                    { flightNumber: callsign.trim() },
                    { 'aircraft.registration': callsign.trim() }
                ]
            });

            return schedule;
        } catch (error) {
            console.error('Error getting flight schedule:', error);
            return null;
        }
    }

    /**
     * Get gate occupancy status
     */
    async getGateStatus() {
        try {
            const driver = dbManager.getNeo4j();
            const session = driver.session();

            const result = await session.run(`
        MATCH (g:Gate)-[:BELONGS_TO]->(t:Terminal)
        OPTIONAL MATCH (f:Flight)-[:ASSIGNED_TO]->(g)
        RETURN 
          g.gateNumber as gate,
          t.terminalName as terminal,
          g.status as status,
          f.callsign as occupiedBy,
          g.capacity as capacity
        ORDER BY t.terminalName, g.gateNumber
      `);

            await session.close();

            const gates = result.records.map(record => ({
                gate: record.get('gate'),
                terminal: record.get('terminal'),
                status: record.get('status') || 'available',
                occupiedBy: record.get('occupiedBy'),
                capacity: record.get('capacity')
            }));

            return gates;
        } catch (error) {
            console.error('Error getting gate status:', error);
            throw error;
        }
    }

    /**
     * Get specific flight details
     */
    async getFlightDetails(flightNumber) {
        try {
            const redis = dbManager.getRedis();

            const trimmed = (flightNumber || '').toString().trim();

            // Try exact Redis key first
            let data = null;
            try {
                const exactKey = `aircraft:${trimmed}:position`;
                const exact = await redis.hGetAll(exactKey);
                if (exact && Object.keys(exact).length > 0) {
                    data = exact;
                }
            } catch (e) {
                // ignore
            }

            // If exact not found, try wildcard search (keys containing the callsign)
            if (!data) {
                try {
                    const keys = await redis.keys(`aircraft:*${trimmed}*:position`);
                    if (keys && keys.length > 0) {
                        data = await redis.hGetAll(keys[0]);
                    }
                } catch (e) {
                    // ignore
                }
            }

            // If we have live data, enrich and return
            if (data && Object.keys(data).length > 0) {
                const callsign = (data.callsign || trimmed).toString().trim();
                const gateInfo = await this.getGateAssignment(callsign);
                const schedule = await this.getFlightSchedule(callsign);

                // Build schedule fallback so UI receives consistent fields
                const scheduleFallback = schedule || {
                    flightNumber: callsign,
                    airline: 'Unknown',
                    aircraft: { iata: 'N/A', registration: null },
                    departure: { iata: 'N/A', airport: 'Unknown' },
                    arrival: { iata: 'N/A', airport: 'Unknown' }
                };

                return {
                    callsign,
                    position: {
                        latitude: parseFloat(data.latitude) || 0,
                        longitude: parseFloat(data.longitude) || 0,
                        altitude: parseFloat(data.altitude) || 0,
                        velocity: parseFloat(data.velocity) || 0,
                        heading: parseFloat(data.heading) || 0
                    },
                    on_ground: (data.on_ground === 'true' || data.on_ground === true),
                    gate: gateInfo?.gate || data.gate || scheduleFallback.departure?.gate || null,
                    terminal: gateInfo?.terminal || scheduleFallback.departure?.terminal || null,
                    status: this.determineStatus(data, schedule),
                    schedule: scheduleFallback,
                    last_update: data.last_update || new Date().toISOString()
                };
            }

            // If not in live data, check MongoDB schedules and return useful fields
            const schedule = await this.getFlightSchedule(trimmed);
            if (schedule) {
                return {
                    callsign: trimmed,
                    position: null,
                    status: schedule.status || 'scheduled',
                    schedule: schedule,
                    gate: schedule.departure?.gate || null,
                    terminal: schedule.departure?.terminal || null
                };
            }

            return null;
        } catch (error) {
            console.error('Error getting flight details:', error);
            throw error;
        }
    }

    /**
     * Determine flight status based on data
     */
    determineStatus(liveData, schedule) {
        if (liveData.on_ground === 'true') {
            return 'on_ground';
        }

        if (schedule) {
            return schedule.status || 'in_flight';
        }

        return 'in_flight';
    }

    /**
     * Get flights by terminal
     */
    async getFlightsByTerminal(terminalName) {
        try {
            const allFlights = await this.getLiveFlights();
            return allFlights.filter(f => f.terminal === terminalName);
        } catch (error) {
            console.error('Error getting flights by terminal:', error);
            throw error;
        }
    }

    /**
     * Get summary statistics
     */
    async getSummary() {
        try {
            const flights = await this.getLiveFlights();
            const gates = await this.getGateStatus();

            return {
                totalFlights: flights.length,
                inFlight: flights.filter(f => !f.on_ground).length,
                onGround: flights.filter(f => f.on_ground).length,
                totalGates: gates.length,
                occupiedGates: gates.filter(g => g.occupiedBy).length,
                availableGates: gates.filter(g => !g.occupiedBy).length,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting summary:', error);
            throw error;
        }
    }
}

module.exports = new FlightMonitorService();