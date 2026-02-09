/**
 * Data Ingestion Service
 * Fetches live flight data from configured API(s) and writes to Redis
 */

const axios = require('axios');
const dbManager = require('../config/database');
require('dotenv').config();

const POLL_INTERVAL_MS = parseInt(process.env.INGEST_POLL_INTERVAL_MS || '5000');
const REDIS_KEY = process.env.INGEST_REDIS_KEY || 'flights:latest';
const REDIS_TTL = parseInt(process.env.INGEST_REDIS_TTL || '15'); // seconds
const API_URL = process.env.INGEST_API_URL || 'https://opensky-network.org/api/states/all';

async function fetchAndStore() {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const data = response.data;

        const redis = dbManager.getRedis();
        // store JSON snapshot and set short TTL
        await redis.set(REDIS_KEY, JSON.stringify(data));
        await redis.expire(REDIS_KEY, REDIS_TTL);

        console.log(new Date().toISOString(), 'Ingested snapshot to Redis', REDIS_KEY);
    } catch (err) {
        console.error('Error fetching/storing ingestion data:', err.message || err);
    }
}

async function start() {
    try {
        await dbManager.connect();

        // immediate fetch
        await fetchAndStore();

        // poll periodically
        const id = setInterval(fetchAndStore, POLL_INTERVAL_MS);

        const shutdown = async () => {
            clearInterval(id);
            await dbManager.disconnect();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        console.log('🚀 Data ingestion service started. Polling', POLL_INTERVAL_MS, 'ms');
    } catch (error) {
        console.error('Failed to start ingestion service:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    start();
}

module.exports = { start };
