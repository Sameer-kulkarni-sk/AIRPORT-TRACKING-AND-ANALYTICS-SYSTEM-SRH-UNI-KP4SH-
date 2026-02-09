/**
 * Flight Monitor Service - Use Case 1
 * Team Member: Sameer Kulkarni
 * 
 * Monitors live flights and gate status
 * Combines data from Redis (live status), Neo4j (gate assignments), and MongoDB (schedules)
 */

const dbManager = require('../config/database');
const apiClient = require('../utils/apiClient');

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
     */
    async getLiveFlights() {
        try {
            const db = dbManager.getMongoDB();
            const collection = db.collection('flight_schedules');

            // Get all schedules from MongoDB
            const schedules = await collection.find({}).toArray();

            if (schedules.length === 0) {
                // Return sample data if no schedules exist
                console.log('⚠️  No flights in MongoDB. Returning sample data.');
                return this.generateSampleFlights();
            }

            // Combine schedule data with Redis position data if available
            const redis = dbManager.getRedis();
            const flights = [];

            for (const schedule of schedules) {
                const callsign = schedule.flightNumber || 'UNKNOWN';
                
                // Try to get live position from Redis
                const positionKey = `aircraft:${callsign}:position`;
                let positionData = null;
                
                try {
                    positionData = await redis.hGetAll(positionKey);
                } catch (error) {
                    // Position data not available, that's ok
                }

                // Try to get gate assignment from Neo4j
                let gateInfo = null;
                try {
                    gateInfo = await this.getGateAssignment(callsign);
                } catch (error) {
                    // Gate info not available, that's ok
                }

                flights.push({
                    callsign: callsign,
                    position: positionData ? {
                        latitude: parseFloat(positionData.latitude),
                        longitude: parseFloat(positionData.longitude),
                        altitude: parseFloat(positionData.altitude),
                        velocity: parseFloat(positionData.velocity),
                        heading: parseFloat(positionData.heading)
                    } : {
                        latitude: 50.0379,
                        longitude: 8.5622,
                        altitude: 30000 + Math.random() * 20000,
                        velocity: 400 + Math.random() * 100,
                        heading: Math.random() * 360
                    },
                    on_ground: positionData?.on_ground === 'true' ? true : false,
                    gate: gateInfo?.gate || schedule.departure?.gate || 'A' + Math.floor(Math.random() * 20),
                    terminal: gateInfo?.terminal || 'Terminal 1',
                    status: this.determineStatus(positionData, schedule),
                    schedule: schedule,
                    last_update: positionData?.last_update || new Date().toISOString()
                });
            }

            return flights;
        } catch (error) {
            console.error('Error getting live flights:', error);
            return this.generateSampleFlights();
        }
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
            },
            {
                callsign: 'DL456',
                position: {
                    latitude: 50.5379,
                    longitude: 8.2622,
                    altitude: 35000,
                    velocity: 450,
                    heading: 270
                },
                on_ground: false,
                gate: 'C12',
                terminal: 'Terminal 2',
                status: 'in-flight',
                schedule: {
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
                last_update: new Date().toISOString()
            },
            {
                callsign: 'BA789',
                position: {
                    latitude: 50.1379,
                    longitude: 8.8622,
                    altitude: 30000,
                    velocity: 420,
                    heading: 180
                },
                on_ground: false,
                gate: 'E8',
                terminal: 'Terminal 3',
                status: 'in-flight',
                schedule: {
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

            // Try to find in live positions
            const keys = await redis.keys(`aircraft:${flightNumber}*:position`);

            if (keys.length > 0) {
                const data = await redis.hGetAll(keys[0]);
                const gateInfo = await this.getGateAssignment(data.callsign);
                const schedule = await this.getFlightSchedule(data.callsign);

                return {
                    callsign: data.callsign,
                    position: {
                        latitude: parseFloat(data.latitude),
                        longitude: parseFloat(data.longitude),
                        altitude: parseFloat(data.altitude),
                        velocity: parseFloat(data.velocity),
                        heading: parseFloat(data.heading)
                    },
                    on_ground: data.on_ground === 'true',
                    gate: gateInfo?.gate || null,
                    terminal: gateInfo?.terminal || null,
                    status: this.determineStatus(data, schedule),
                    schedule: schedule,
                    last_update: data.last_update
                };
            }

            // If not in live data, check MongoDB
            const schedule = await this.getFlightSchedule(flightNumber);
            if (schedule) {
                return {
                    callsign: flightNumber,
                    position: null,
                    status: schedule.status || 'scheduled',
                    schedule: schedule
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