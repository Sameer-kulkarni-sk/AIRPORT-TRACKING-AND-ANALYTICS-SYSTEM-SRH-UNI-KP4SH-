const dbManager = require('../config/database');

class PassengerService {
    
    async getFlightInfo(flightNumber) {
        try {
            const db = dbManager.getMongoDB();
            const redis = dbManager.getRedis();

            // Try exact match by flight number (uppercase)
            const schedule = await db.collection('flight_schedules').findOne({
                flightNumber: flightNumber.toUpperCase()
            });

            // If not found, try searching by registration or partial match
            let scheduleFound = schedule;
            if (!scheduleFound) {
                scheduleFound = await db.collection('flight_schedules').findOne({
                    $or: [
                        { 'aircraft.registration': flightNumber.toUpperCase() },
                        { flightNumber: { $regex: `^${flightNumber}`, $options: 'i' } },
                        { flightNumber: { $regex: flightNumber, $options: 'i' } }
                    ]
                });
            }

            // Try to find live position in Redis using several patterns
            let liveData = {};
            try {
                const candidateKeys = await redis.keys(`aircraft:${flightNumber}*:position`);
                if (candidateKeys && candidateKeys.length > 0) {
                    liveData = await redis.hGetAll(candidateKeys[0]);
                } else {
                    // fallback to exact key
                    const liveKey = `aircraft:${flightNumber}:position`;
                    liveData = await redis.hGetAll(liveKey);
                }
            } catch (e) {
                liveData = {};
            }

            // If we have either schedule or liveData, proceed
            if (!scheduleFound && (!liveData || Object.keys(liveData).length === 0)) {
                // Return a basic response for unknown flights
                return {
                    flightNumber: flightNumber.toUpperCase(),
                    airline: 'Unknown Airline',
                    airlineCode: null,
                    departure: {
                        airport: 'Unknown',
                        iata: 'N/A',
                        scheduled: new Date().toISOString(),
                        terminal: 'TBA',
                        gate: 'TBA'
                    },
                    arrival: {
                        airport: 'Unknown',
                        iata: 'N/A',
                        scheduled: new Date().toISOString(),
                        terminal: 'TBA',
                        gate: 'TBA'
                    },
                    status: 'Unknown',
                    delay: 0,
                    aircraft: null,
                    currentPosition: null
                };
            }

            const gateInfo = await this.getGateAssignment(flightNumber);

            let delayMinutes = 0;
            if (scheduleFound && scheduleFound.departure && scheduleFound.departure.actual && scheduleFound.departure.scheduled) {
                const actual = new Date(scheduleFound.departure.actual);
                const scheduled = new Date(scheduleFound.departure.scheduled);
                delayMinutes = Math.round((actual - scheduled) / 60000);
            }

            // Build response combining schedule (if any) and liveData
            const response = {
                flightNumber: scheduleFound ? scheduleFound.flightNumber : (flightNumber.toUpperCase()),
                airline: scheduleFound ? scheduleFound.airline : 'Unknown Airline',
                airlineCode: scheduleFound ? scheduleFound.airlineCode : null,
                departure: scheduleFound ? {
                    airport: scheduleFound.departure?.airport || 'Unknown',
                    iata: scheduleFound.departure?.iata || 'N/A',
                    scheduled: scheduleFound.departure?.scheduled,
                    estimated: scheduleFound.departure?.estimated,
                    actual: scheduleFound.departure?.actual,
                    terminal: gateInfo?.terminal || scheduleFound.departure?.terminal || 'TBA',
                    gate: gateInfo?.gate || scheduleFound.departure?.gate || 'TBA'
                } : {
                    airport: 'Unknown',
                    iata: 'N/A',
                    scheduled: new Date().toISOString(),
                    terminal: gateInfo?.terminal || 'TBA',
                    gate: gateInfo?.gate || 'TBA'
                },
                arrival: scheduleFound ? {
                    airport: scheduleFound.arrival?.airport || 'Unknown',
                    iata: scheduleFound.arrival?.iata || 'N/A',
                    scheduled: scheduleFound.arrival?.scheduled,
                    estimated: scheduleFound.arrival?.estimated,
                    actual: scheduleFound.arrival?.actual,
                    terminal: scheduleFound.arrival?.terminal || 'TBA',
                    gate: scheduleFound.arrival?.gate || 'TBA'
                } : {
                    airport: 'Unknown',
                    iata: 'N/A',
                    scheduled: new Date().toISOString(),
                    terminal: 'TBA',
                    gate: 'TBA'
                },
                status: scheduleFound ? this.determineStatus(scheduleFound, liveData) : (liveData && liveData.on_ground === 'true' ? 'On Ground' : 'In Flight'),
                delay: delayMinutes,
                aircraft: scheduleFound ? scheduleFound.aircraft : null,
                currentPosition: (liveData && liveData.latitude) ? {
                    latitude: parseFloat(liveData.latitude),
                    longitude: parseFloat(liveData.longitude),
                    altitude: parseFloat(liveData.altitude)
                } : null
            };

            return response;
        } catch (error) {
            console.error('Error getting flight info:', error);
            throw error;
        }
    }

  
    async getGateAssignment(flightNumber) {
        try {
            const driver = dbManager.getNeo4j();
            const session = driver.session();

            const result = await session.run(`
        MATCH (f:Flight {flightNumber: $flightNumber})-[:ASSIGNED_TO]->(g:Gate)-[:BELONGS_TO]->(t:Terminal)
        RETURN g.gateNumber as gate, t.terminalName as terminal
      `, { flightNumber: flightNumber.toUpperCase() });

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

    
    determineStatus(schedule, liveData) {
        if (schedule.status === 'cancelled') return 'Cancelled';
        if (schedule.arrival.actual) return 'Landed';
        if (schedule.departure.actual) return 'In Flight';
        if (liveData && liveData.on_ground === 'true') return 'Boarding';
        if (schedule.status === 'delayed') return 'Delayed';
        return 'On Time';
    }

    
    async searchFlights(query) {
        try {
            const db = dbManager.getMongoDB();

            const searchQuery = {
                $or: [
                    { flightNumber: { $regex: query, $options: 'i' } },
                    { airline: { $regex: query, $options: 'i' } },
                    { 'departure.airport': { $regex: query, $options: 'i' } },
                    { 'arrival.airport': { $regex: query, $options: 'i' } }
                ]
            };

            const flights = await db.collection('flight_schedules')
                .find(searchQuery)
                .limit(20)
                .toArray();

            return flights.map(f => ({
                flightNumber: f.flightNumber,
                airline: f.airline,
                departure: f.departure.airport,
                arrival: f.arrival.airport,
                status: f.status,
                scheduledDeparture: f.departure.scheduled
            }));
        } catch (error) {
            console.error('Error searching flights:', error);
            throw error;
        }
    }

    
    async getFlightsByAirline(airlineCode) {
        try {
            const db = dbManager.getMongoDB();

            const flights = await db.collection('flight_schedules')
                .find({ airlineCode: airlineCode.toUpperCase() })
                .sort({ 'departure.scheduled': 1 })
                .limit(50)
                .toArray();

            return flights;
        } catch (error) {
            console.error('Error getting flights by airline:', error);
            throw error;
        }
    }

    
    async getTodayDepartures() {
        try {
            const db = dbManager.getMongoDB();
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const flights = await db.collection('flight_schedules')
                .find({
                    'departure.scheduled': {
                        $gte: today.toISOString(),
                        $lt: tomorrow.toISOString()
                    }
                })
                .sort({ 'departure.scheduled': 1 })
                .toArray();

            return flights;
        } catch (error) {
            console.error('Error getting today departures:', error);
            throw error;
        }
    }
}

module.exports = new PassengerService();
