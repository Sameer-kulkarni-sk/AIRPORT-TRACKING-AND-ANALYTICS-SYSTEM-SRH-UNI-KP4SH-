/**
 * Collision Detection Service - Use Case 3
 * Team Member: Shambhavi Pillai
 * 
 * Detects potential mid-air collisions between aircraft
 */

const dbManager = require('../config/database');

class CollisionDetectionService {
    constructor() {
        this.SAFE_DISTANCE_KM = parseFloat(process.env.COLLISION_SAFE_DISTANCE_KM || '5');
        this.SAFE_ALTITUDE_DIFF_FT = parseFloat(process.env.COLLISION_SAFE_ALTITUDE_FT || '1000');
        this.checkInterval = null;
    }

    /**
     * Start continuous collision monitoring
     */
    startMonitoring() {
        const interval = parseInt(process.env.COLLISION_CHECK_INTERVAL || '5') * 1000;

        console.log(`⚠️  Starting collision detection (check every ${interval / 1000}s)`);

        // Initial check
        this.checkCollisionRisks();

        // Set up periodic checks
        this.checkInterval = setInterval(() => {
            this.checkCollisionRisks();
        }, interval);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            console.log('⏹️  Collision detection stopped');
        }
    }

    /**
     * Check for collision risks between all aircraft
     */
    async checkCollisionRisks() {
        try {
            const redis = dbManager.getRedis();

            // Get all aircraft positions
            const keys = await redis.keys('aircraft:*:position');

            if (keys.length < 2) {
                return []; // Need at least 2 aircraft
            }

            const positions = [];
            for (const key of keys) {
                const data = await redis.hGetAll(key);
                if (data && data.callsign && data.on_ground !== 'true') {
                    positions.push({
                        callsign: data.callsign,
                        latitude: parseFloat(data.latitude),
                        longitude: parseFloat(data.longitude),
                        altitude: parseFloat(data.altitude),
                        velocity: parseFloat(data.velocity),
                        heading: parseFloat(data.heading)
                    });
                }
            }

            // Check all pairs
            const alerts = [];
            for (let i = 0; i < positions.length; i++) {
                for (let j = i + 1; j < positions.length; j++) {
                    const alert = this.checkPairCollision(positions[i], positions[j]);
                    if (alert) {
                        alerts.push(alert);
                        // Store alert in Redis
                        await this.storeAlert(alert);
                    }
                }
            }

            if (alerts.length > 0) {
                console.log(`⚠️  ${alerts.length} collision risk(s) detected!`);
            }

            return alerts;
        } catch (error) {
            console.error('Error checking collision risks:', error);
            return [];
        }
    }

    /**
     * Check collision risk between two aircraft
     */
    checkPairCollision(aircraft1, aircraft2) {
        // Calculate horizontal distance
        const distance = this.calculateDistance(
            aircraft1.latitude,
            aircraft1.longitude,
            aircraft2.latitude,
            aircraft2.longitude
        );

        // Calculate altitude difference
        const altitudeDiff = Math.abs(aircraft1.altitude - aircraft2.altitude);

        // Check if unsafe
        if (distance < this.SAFE_DISTANCE_KM && altitudeDiff < this.SAFE_ALTITUDE_DIFF_FT) {
            const severity = this.calculateSeverity(distance, altitudeDiff);

            return {
                id: `${aircraft1.callsign}-${aircraft2.callsign}-${Date.now()}`,
                flight1: {
                    callsign: aircraft1.callsign,
                    latitude: aircraft1.latitude,
                    longitude: aircraft1.longitude,
                    altitude: aircraft1.altitude,
                    velocity: aircraft1.velocity,
                    heading: aircraft1.heading
                },
                flight2: {
                    callsign: aircraft2.callsign,
                    latitude: aircraft2.latitude,
                    longitude: aircraft2.longitude,
                    altitude: aircraft2.altitude,
                    velocity: aircraft2.velocity,
                    heading: aircraft2.heading
                },
                distance: parseFloat(distance.toFixed(2)),
                altitudeDiff: Math.round(altitudeDiff),
                severity: severity,
                timestamp: new Date().toISOString()
            };
        }

        return null;
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
     * Calculate severity level
     */
    calculateSeverity(distance, altitudeDiff) {
        if (distance < 2 && altitudeDiff < 500) {
            return 'CRITICAL';
        } else if (distance < 5 && altitudeDiff < 1000) {
            return 'WARNING';
        } else {
            return 'SAFE';
        }
    }

    /**
     * Store alert in Redis
     */
    async storeAlert(alert) {
        try {
            const redis = dbManager.getRedis();
            const key = `alert:collision:${alert.id}`;

            await redis.set(key, JSON.stringify(alert), {
                EX: 300 // Expire after 5 minutes
            });

            // Also add to active alerts list
            await redis.lPush('alerts:collision:active', JSON.stringify(alert));
            await redis.lTrim('alerts:collision:active', 0, 99); // Keep last 100
        } catch (error) {
            console.error('Error storing alert:', error);
        }
    }

    /**
     * Get active collision alerts
     */
    async getActiveAlerts() {
        try {
            const redis = dbManager.getRedis();
            const alerts = await redis.lRange('alerts:collision:active', 0, -1);

            return alerts.map(a => JSON.parse(a));
        } catch (error) {
            console.error('Error getting active alerts:', error);
            return [];
        }
    }

    /**
     * Get alert history
     */
    async getAlertHistory(limit = 50) {
        try {
            const redis = dbManager.getRedis();
            const keys = await redis.keys('alert:collision:*');

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
            console.error('Error getting alert history:', error);
            return [];
        }
    }
}

module.exports = new CollisionDetectionService();