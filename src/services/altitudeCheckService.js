/**
 * Altitude Check Service - Use Case 4
 * Team Member: Prajwal Vijaykumar
 * 
 * Detects aircraft flying below safe altitude outside airport zones
 */

const dbManager = require('../config/database');
const apiClient = require('../utils/apiClient');

class AltitudeCheckService {
    constructor() {
        this.MIN_SAFE_ALTITUDE_FT = parseFloat(process.env.MIN_SAFE_ALTITUDE_FT || '1000');
        this.checkInterval = null;
    }

    /**
     * Start continuous altitude monitoring
     */
    startMonitoring() {
        const interval = parseInt(process.env.ALTITUDE_CHECK_INTERVAL || '5') * 1000;

        console.log(`📉 Starting altitude monitoring (check every ${interval / 1000}s)`);

        // Initial check
        this.checkLowAltitudeAircraft();

        // Set up periodic checks
        this.checkInterval = setInterval(() => {
            this.checkLowAltitudeAircraft();
        }, interval);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            console.log('⏹️  Altitude monitoring stopped');
        }
    }

    /**
     * Check for low-altitude aircraft and return all monitored aircraft
     */
    async checkLowAltitudeAircraft() {
        try {
            const redis = dbManager.getRedis();

            // Get all aircraft positions
            const keys = await redis.keys('aircraft:*:position');
            const lowAltitudeAlerts = [];
            const allAircraft = [];

            for (const key of keys) {
                const data = await redis.hGetAll(key);

                if (!data || !data.callsign || data.on_ground === 'true') {
                    continue;
                }

                const callsign = data.callsign;
                const altitude = parseFloat(data.altitude);
                const latitude = parseFloat(data.latitude);
                const longitude = parseFloat(data.longitude);
                const velocity = parseFloat(data.velocity) || 0;
                const heading = parseFloat(data.heading) || 0;

                // Check if aircraft is in airport zone
                const airportZoneInfo = await this.getAirportZoneInfo(latitude, longitude);

                // Build aircraft info
                const aircraftInfo = {
                    callsign,
                    altitude,
                    latitude,
                    longitude,
                    velocity,
                    heading,
                    inAirportZone: airportZoneInfo.inZone,
                    airportName: airportZoneInfo.airportName,
                    zoneName: airportZoneInfo.zoneName,
                    distanceToAirport: airportZoneInfo.distance
                };

                allAircraft.push(aircraftInfo);

                // Check if altitude is below threshold
                if (altitude < this.MIN_SAFE_ALTITUDE_FT) {
                    // If NOT in airport zone, create alert
                    if (!airportZoneInfo.inZone) {
                        const alert = {
                            id: `${callsign}-${Date.now()}`,
                            callsign,
                            altitude,
                            latitude,
                            longitude,
                            velocity,
                            heading,
                            severity: this.calculateSeverity(altitude),
                            message: 'Aircraft flying below safe altitude outside airport zone',
                            inAirportZone: false,
                            airportName: null,
                            zoneName: null,
                            distanceToAirport: airportZoneInfo.distance,
                            timestamp: new Date().toISOString()
                        };

                        lowAltitudeAlerts.push(alert);
                        await this.storeAlert(alert);
                    } else {
                        // Aircraft is low but in airport zone - still track it
                        const alert = {
                            id: `${callsign}-${Date.now()}`,
                            callsign,
                            altitude,
                            latitude,
                            longitude,
                            velocity,
                            heading,
                            severity: 'SAFE',
                            message: `Aircraft in ${airportZoneInfo.airportName} ${airportZoneInfo.zoneName} - Normal operations`,
                            inAirportZone: true,
                            airportName: airportZoneInfo.airportName,
                            zoneName: airportZoneInfo.zoneName,
                            distanceToAirport: airportZoneInfo.distance,
                            timestamp: new Date().toISOString()
                        };
                        lowAltitudeAlerts.push(alert);
                    }
                }
            }

            if (lowAltitudeAlerts.filter(a => a.severity !== 'SAFE').length > 0) {
                console.log(`📉 ${lowAltitudeAlerts.filter(a => a.severity !== 'SAFE').length} low-altitude alert(s) detected!`);
            }

            return {
                alerts: lowAltitudeAlerts,
                totalAircraft: allAircraft.length,
                monitoredAircraft: allAircraft
            };
        } catch (error) {
            console.error('Error checking low-altitude aircraft:', error);
            return { alerts: [], totalAircraft: 0, monitoredAircraft: [] };
        }
    }

    /**
     * Get detailed airport zone information
     */
    async getAirportZoneInfo(latitude, longitude) {
        let session = null;
        try {
            const driver = dbManager.getNeo4j();
            session = driver.session();

            const result = await session.run(`
        MATCH (a:Airport)-[:HAS_ZONE]->(z:Zone)
        WITH a, z, point.distance(
          point({latitude: $lat, longitude: $lon}),
          point({latitude: z.latitude, longitude: z.longitude})
        ) as distance
        WHERE distance < z.radiusMeters
        RETURN a.name as airport, a.code as airportCode, z.name as zone,
               distance / 1000 as distanceKm
        ORDER BY distance
        LIMIT 1
      `, { lat: latitude, lon: longitude });

            if (result.records.length > 0) {
                const record = result.records[0];
                return {
                    inZone: true,
                    airportName: record.get('airport'),
                    airportCode: record.get('airportCode'),
                    zoneName: record.get('zone'),
                    distance: parseFloat(record.get('distanceKm').toFixed(2))
                };
            }

            // Not in any zone, find nearest airport
            const nearestResult = await session.run(`
        MATCH (a:Airport)
        WITH a, point.distance(
          point({latitude: $lat, longitude: $lon}),
          point({latitude: a.latitude, longitude: a.longitude})
        ) as distance
        RETURN a.name as airport, a.code as airportCode, distance / 1000 as distanceKm
        ORDER BY distance
        LIMIT 1
      `, { lat: latitude, lon: longitude });

            if (nearestResult.records.length > 0) {
                const record = nearestResult.records[0];
                return {
                    inZone: false,
                    airportName: record.get('airport'),
                    airportCode: record.get('airportCode'),
                    zoneName: null,
                    distance: parseFloat(record.get('distanceKm').toFixed(2))
                };
            }

            return {
                inZone: false,
                airportName: null,
                airportCode: null,
                zoneName: null,
                distance: null
            };
        } catch (error) {
            console.error('Error getting airport zone info:', error);
            return {
                inZone: false,
                airportName: null,
                airportCode: null,
                zoneName: null,
                distance: null
            };
        } finally {
            if (session) {
                await session.close();
            }
        }
    }

    /**
     * Check if coordinates are within airport zone using Neo4j
     */
    async isInAirportZone(latitude, longitude) {
        const info = await this.getAirportZoneInfo(latitude, longitude);
        return info.inZone;
    }

    /**
     * Calculate severity based on altitude
     */
    calculateSeverity(altitude) {
        if (altitude < 500) {
            return 'CRITICAL';
        } else if (altitude < 750) {
            return 'HIGH';
        } else {
            return 'MEDIUM';
        }
    }

    /**
     * Store alert in Redis
     */
    async storeAlert(alert) {
        try {
            const redis = dbManager.getRedis();
            const key = `alert:low-altitude:${alert.id}`;

            await redis.set(key, JSON.stringify(alert), {
                EX: 300 // Expire after 5 minutes
            });

            // Also add to active alerts list
            await redis.lPush('alerts:altitude:active', JSON.stringify(alert));
            await redis.lTrim('alerts:altitude:active', 0, 99); // Keep last 100
        } catch (error) {
            console.error('Error storing altitude alert:', error);
        }
    }

    /**
     * Get active altitude alerts with full monitoring data
     */
    async getActiveAlerts() {
        try {
            const result = await this.checkLowAltitudeAircraft();
            return result;
        } catch (error) {
            console.error('Error getting active altitude alerts:', error);
            return { alerts: [], totalAircraft: 0, monitoredAircraft: [] };
        }
    }

    /**
     * Check all altitude violations (for API endpoint)
     */
    async checkAltitudeViolations() {
        return await this.checkLowAltitudeAircraft();
    }

    /**
     * Get specific aircraft altitude status
     */
    async getAircraftAltitudeStatus(callsign) {
        try {
            const redis = dbManager.getRedis();
            const key = `aircraft:${callsign}:position`;
            const data = await redis.hGetAll(key);

            if (!data || !data.altitude) {
                return null;
            }

            const altitude = parseFloat(data.altitude);
            const latitude = parseFloat(data.latitude);
            const longitude = parseFloat(data.longitude);
            const inAirportZone = await this.isInAirportZone(latitude, longitude);

            return {
                callsign,
                altitude,
                position: { latitude, longitude },
                inAirportZone,
                isSafe: altitude >= this.MIN_SAFE_ALTITUDE_FT || inAirportZone,
                minSafeAltitude: this.MIN_SAFE_ALTITUDE_FT,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting aircraft altitude status:', error);
            return null;
        }
    }

    /**
     * Get alert history
     */
    async getAlertHistory(limit = 50) {
        try {
            const redis = dbManager.getRedis();
            const keys = await redis.keys('alert:low-altitude:*');

            const alerts = [];
            for (const key of keys.slice(0, limit)) {
                const data = await redis.get(key);
                if (data) {
                    alerts.push(JSON.parse(data));
                }
            }

            return alerts.sort((a, b) =>
                new Date(b.timestamp) - new Date(a.timestamp)
            );
        } catch (error) {
            console.error('Error getting altitude alert history:', error);
            return [];
        }
    }
}

module.exports = new AltitudeCheckService();