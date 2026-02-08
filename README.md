# ✈️ Airport Tracking and Analytics System

> A comprehensive real-time airport monitoring system built by students at SRH University

[![Node.js](https://img.shields.io/badge/Node.js-16+-green.svg)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0-green.svg)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/Redis-7.0-red.svg)](https://redis.io/)
[![Neo4j](https://img.shields.io/badge/Neo4j-5.0-blue.svg)](https://neo4j.com/)

## 📖 Overview

This project demonstrates how live air traffic data can make airports safer and more efficient. By combining real-time aircraft positions from **OpenSky Network** and **AviationStack** with three specialized databases (**MongoDB**, **Redis**, and **Neo4j**), we've built a comprehensive dashboard that:

- 🛫 Monitors live flights and gate status
- ⚠️ Detects potential mid-air collisions
- 📉 Identifies low-altitude risks
- 📊 Tracks airport performance KPIs
- 👥 Provides passenger flight information
- 📜 Analyzes historical flight data
- 🔄 Replays flight routes for investigation

## 👥 Team Members

| Name | Use Case | GitHub |
|------|----------|--------|
| **Sameer Kulkarni** | Live Flight & Gate Monitoring | [@Sameer-kulkarni-sk](https://github.com/Sameer-kulkarni-sk) |
| **Harjot Singh** | Airport KPIs | - |
| **Shambhavi Pillai** | Collision Detection | - |
| **Prajwal Vijaykumar** | Low-Altitude Detection | - |
| **Kartheek Tatagari** | Passenger Information | - |
| **Smitha Anoop** | Flight History | - |
| **Shahid Sherwani** | Flight Replay | - |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    External APIs                         │
│         OpenSky Network  |  AviationStack               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────┐
│                  Backend Services                        │
│  Data Ingestion | Collision Detection | Altitude Check  │
└────────┬────────────────┬────────────────┬──────────────┘
         ↓                ↓                ↓
    ┌────────┐      ┌─────────┐      ┌──────────┐
    │ Redis  │      │  Neo4j  │      │ MongoDB  │
    │(Cache) │      │ (Graph) │      │(Document)│
    └────┬───┘      └────┬────┘      └────┬─────┘
         │               │                 │
         └───────────────┴─────────────────┘
                         ↓
         ┌───────────────────────────────┐
         │      Frontend Dashboard       │
         │  Live Map | Tables | Charts   │
         └───────────────────────────────┘
```

## 🗄️ Database Strategy

### Why Three Databases?

| Database | Purpose | Use Cases |
|----------|---------|-----------|
| **Redis** | Real-time cache | Live flight status, aircraft positions, alerts |
| **Neo4j** | Graph relationships | Flight-gate assignments, airport zones |
| **MongoDB** | Historical data | Flight schedules, passenger info, telemetry |

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ ([Download](https://nodejs.org/))
- **Docker Desktop** ([Download](https://www.docker.com/products/docker-desktop/))
- **Git** ([Download](https://git-scm.com/))

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Sameer-kulkarni-sk/AIRPORT-TRACKING-AND-ANALYTICS-SYSTEM-SRH-UNI-KP4SH-
cd AIRPORT-TRACKING-AND-ANALYTICS-SYSTEM-SRH-UNI-KP4SH-

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and add your AVIATIONSTACK_API_KEY

# 4. Start databases with Docker
docker-compose up -d

# 5. Wait for databases to be ready (30 seconds)
# Check status: docker-compose ps

# 6. Seed initial data
npm run seed

# 7. Start the backend server
npm start
```

### Access the Application

- **Main Dashboard**: http://localhost:8080/dashboard
- **KPI Dashboard**: http://localhost:8080/kpi
- **Passenger Search**: http://localhost:8080/passenger
- **Flight History**: http://localhost:8080/history
- **Flight Replay**: http://localhost:8080/replay
- **Neo4j Browser**: http://localhost:7474 (user: neo4j, pass: airport123)

## 📚 Documentation

For detailed implementation guide, see [PROJECT_GUIDE.md](PROJECT_GUIDE.md)

### Key Features by Use Case

#### 1️⃣ Live Flight & Gate Monitoring (Sameer)
- Real-time flight status updates
- Gate assignment visualization
- Terminal occupancy tracking
- Delay notifications

#### 2️⃣ Airport KPIs (Harjot)
- On-time performance metrics
- Average delay calculations
- Flight activity statistics
- Performance trends

#### 3️⃣ Collision Detection (Shambhavi)
- Real-time distance calculations
- Altitude separation monitoring
- Automatic alert generation
- Visual warnings on dashboard

#### 4️⃣ Low-Altitude Detection (Prajwal)
- Altitude threshold monitoring
- Airport zone verification
- Safety alert system
- Map-based visualization

#### 5️⃣ Passenger Information (Kartheek)
- Flight number search
- Real-time status updates
- Gate and terminal info
- Delay notifications

#### 6️⃣ Flight History (Smitha)
- Historical data analysis
- Performance reporting
- Trend visualization
- Data export capabilities

#### 7️⃣ Flight Replay (Shahid)
- Route visualization
- Telemetry playback
- Incident investigation
- Timeline controls

## 🛠️ Development

### Project Structure

```
airport-tracking-system/
├── src/
│   ├── services/          # Backend services
│   │   ├── flightMonitorService.js
│   │   ├── collisionService.js
│   │   ├── altitudeCheckService.js
│   │   ├── kpiService.js
│   │   ├── passengerService.js
│   │   ├── historyService.js
│   │   └── replayService.js
│   ├── routes/            # API endpoints
│   ├── models/            # Data models
│   └── utils/             # Helper functions
├── public/                # Frontend files
│   ├── dashboard.html
│   ├── kpi.html
│   ├── passenger.html
│   ├── history.html
│   ├── replay.html
│   ├── css/
│   └── js/
├── scripts/               # Setup and seed scripts
├── tests/                 # Test files
├── docker-compose.yml     # Database configuration
├── package.json
├── .env.example
└── README.md
```

### Running Individual Services

```bash
# Start collision detection service
npm run collision-service

# Start altitude monitoring service
npm run altitude-service

# Start data ingestion service
npm run data-ingestion
```

### Running Tests

```bash
npm test
```

## 📊 API Endpoints

### Flight Monitoring
- `GET /api/flights/live` - Get all live flights
- `GET /api/flights/:flightNumber` - Get specific flight details
- `GET /api/gates/status` - Get gate occupancy status

### Safety Alerts
- `GET /api/alerts/collision` - Get collision alerts
- `GET /api/alerts/altitude` - Get low-altitude alerts

### KPIs
- `GET /api/kpi/summary` - Get airport KPI summary
- `GET /api/kpi/delays` - Get delay statistics

### Passenger
- `GET /api/passenger/flight/:flightNumber` - Search flight by number

### History
- `GET /api/history/flights` - Get flight history
- `GET /api/history/statistics` - Get historical statistics

### Replay
- `GET /api/replay/:flightNumber/:date` - Get flight telemetry for replay

## 🔧 Configuration

### Environment Variables

See [.env.example](.env.example) for all configuration options.

Key settings:
- `AVIATIONSTACK_API_KEY` - Your AviationStack API key
- `AIRPORT_ICAO` - Airport ICAO code (default: EDDF)
- `COLLISION_SAFE_DISTANCE_KM` - Minimum safe distance (default: 5 km)
- `MIN_SAFE_ALTITUDE_FT` - Minimum safe altitude (default: 1000 ft)

## 🧪 Testing

### Manual Testing Checklist

- [ ] Dashboard loads and displays flights
- [ ] Live data updates every 10 seconds
- [ ] Collision alerts appear when aircraft are close
- [ ] Low-altitude warnings show on map
- [ ] Passenger search returns correct results
- [ ] Historical data loads properly
- [ ] Flight replay animation works

### Sample Test Data

The system includes seed data for testing:
- 50 sample flights
- 20 gates across 3 terminals
- Historical flight records
- Sample telemetry data

## 📈 Performance

- **Real-time updates**: < 1 second latency
- **API response time**: < 100ms average
- **Database queries**: Optimized with indexes
- **Concurrent users**: Supports 100+ simultaneous connections

## 🔒 Security

- Environment variables for sensitive data
- CORS protection
- Input validation
- Rate limiting on API endpoints
- Secure database connections

## 🐛 Troubleshooting

### Common Issues

**Problem**: Cannot connect to databases
```bash
# Solution: Check Docker containers
docker-compose ps
docker-compose logs
```

**Problem**: API rate limit exceeded
```bash
# Solution: Reduce refresh interval in .env
FLIGHT_DATA_REFRESH_INTERVAL=30
```

**Problem**: Frontend not updating
```bash
# Solution: Clear browser cache and check console
# Press F12 → Console tab
```

## 📝 License

This project is created for educational purposes at SRH University.

## 🙏 Acknowledgments

- **OpenSky Network** - Free flight tracking data
- **AviationStack** - Comprehensive aviation API
- **SRH University** - Project supervision and support

## 📞 Contact

For questions or support, please contact:
- **Project Lead**: Sameer Kulkarni
- **Repository**: [GitHub](https://github.com/Sameer-kulkarni-sk/AIRPORT-TRACKING-AND-ANALYTICS-SYSTEM-SRH-UNI-KP4SH-)

---

**Made with ❤️ by SRH University Students**