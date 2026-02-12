/**
 * KPI Service - Use Case 2
 * Team Member: Harjot Singh
 * 
 * Monitors airport performance metrics and KPIs
 */

const dbManager = require('../config/database');

class KPIService {
    /**
     * Get current KPI summary
     */
    async getKPISummary() {
        try {
            const redis = dbManager.getRedis();
            const db = dbManager.getMongoDB();

            // Get live flight data from Redis
            const liveFlightKeys = await redis.keys('aircraft:*:position');
            const liveFlights = [];

            for (const key of liveFlightKeys) {
                const data = await redis.hGetAll(key);
                if (data && Object.keys(data).length > 0) {
                    liveFlights.push({
                        callsign: data.callsign || key.split(':')[1],
                        on_ground: data.on_ground === 'true',
                        last_update: data.last_update
                    });
                }
            }

            // Calculate live flight statistics
            const totalLiveFlights = liveFlights.length;
            const airborneFlights = liveFlights.filter(f => !f.on_ground).length;
            const groundFlights = liveFlights.filter(f => f.on_ground).length;

            // Get scheduled flight data from MongoDB for today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const flightStats = await db.collection('flight_schedules').aggregate([
                {
                    $match: {
                        'departure.scheduled': {
                            $gte: today.toISOString()
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        delayed: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'delayed'] }, 1, 0]
                            }
                        },
                        onTime: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                            }
                        },
                        cancelled: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0]
                            }
                        }
                    }
                }
            ]).toArray();

            const scheduledStats = flightStats[0] || { total: 0, delayed: 0, onTime: 0, cancelled: 0 };

            // Combine live and scheduled data
            const totalFlights = totalLiveFlights + scheduledStats.total;
            const delayedFlights = scheduledStats.delayed; // Only scheduled flights can be delayed
            const onTimeFlights = scheduledStats.onTime + airborneFlights; // Active scheduled + airborne live flights
            const cancelledFlights = scheduledStats.cancelled;

            const onTimePercentage = totalFlights > 0
                ? ((onTimeFlights / totalFlights) * 100).toFixed(2)
                : 0;

            return {
                totalFlights: totalFlights,
                delayedFlights: delayedFlights,
                onTimeFlights: onTimeFlights,
                cancelledFlights: cancelledFlights,
                onTimePercentage: parseFloat(onTimePercentage),
                liveFlights: totalLiveFlights,
                airborneFlights: airborneFlights,
                groundFlights: groundFlights,
                scheduledFlights: scheduledStats.total,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting KPI summary:', error);
            throw error;
        }
    }

    /**
     * Get delay statistics
     */
    async getDelayStatistics() {
        try {
            const db = dbManager.getMongoDB();

            const delayStats = await db.collection('flight_schedules').aggregate([
                {
                    $match: {
                        status: 'delayed'
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgDelay: { $avg: '$delayMinutes' },
                        maxDelay: { $max: '$delayMinutes' },
                        minDelay: { $min: '$delayMinutes' },
                        totalDelayed: { $sum: 1 }
                    }
                }
            ]).toArray();

            const stats = delayStats[0] || {
                avgDelay: 0,
                maxDelay: 0,
                minDelay: 0,
                totalDelayed: 0
            };

            return {
                averageDelay: Math.round(stats.avgDelay || 0),
                maximumDelay: stats.maxDelay || 0,
                minimumDelay: stats.minDelay || 0,
                totalDelayedFlights: stats.totalDelayed,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting delay statistics:', error);
            throw error;
        }
    }

    /**
     * Get performance trends
     */
    async getPerformanceTrends(days = 7) {
        try {
            const db = dbManager.getMongoDB();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const trends = await db.collection('flight_history').aggregate([
                {
                    $match: {
                        date: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$date' }
                        },
                        totalFlights: { $sum: 1 },
                        delayed: {
                            $sum: { $cond: [{ $eq: ['$status', 'delayed'] }, 1, 0] }
                        },
                        onTime: {
                            $sum: { $cond: [{ $ne: ['$status', 'delayed'] }, 1, 0] }
                        },
                        avgDelay: { $avg: '$delayMinutes' }
                    }
                },
                {
                    $sort: { _id: 1 }
                }
            ]).toArray();

            return {
                period: `${days} days`,
                data: trends.map(t => ({
                    date: t._id,
                    totalFlights: t.totalFlights,
                    delayedFlights: t.delayed,
                    onTimeFlights: t.onTime,
                    averageDelay: Math.round(t.avgDelay || 0),
                    onTimePercentage: ((t.onTime / t.totalFlights) * 100).toFixed(2)
                }))
            };
        } catch (error) {
            console.error('Error getting performance trends:', error);
            throw error;
        }
    }

    /**
     * Update KPI counters in Redis
     */
    async updateKPICounters() {
        try {
            const redis = dbManager.getRedis();
            const db = dbManager.getMongoDB();

            // Count flights by status
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const counts = await db.collection('flight_schedules').aggregate([
                {
                    $match: {
                        'departure.scheduled': { $gte: today.toISOString() }
                    }
                },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]).toArray();

            let total = 0;
            let delayed = 0;
            let onTime = 0;

            counts.forEach(c => {
                total += c.count;
                if (c._id === 'delayed') delayed = c.count;
                if (c._id === 'active') onTime = c.count;
            });

            // Update Redis counters
            await redis.set('kpi:flights:total', total.toString());
            await redis.set('kpi:flights:delayed', delayed.toString());
            await redis.set('kpi:flights:ontime', onTime.toString());

            console.log(`✅ KPI counters updated: ${total} total, ${delayed} delayed, ${onTime} on-time`);
        } catch (error) {
            console.error('Error updating KPI counters:', error);
        }
    }
}

module.exports = new KPIService();