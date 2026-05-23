# Aegis (StormWatch) 🛰️🌍
> **An AI-Driven Space Weather Early Warning System with Physics-Based Historical Failsafe Engine**

Aegis (StormWatch) is a full-stack, multi-container microservice platform designed to translate chaotic solar wind telemetry into precise, actionable alerts for critical infrastructure operators. Moving away from abstract scientific plots, Aegis renders a real-time 3D geospace simulation alongside a predictive Machine Learning pipeline to anticipate geomagnetic storm severity ($Kp\text{ Index}$) before particles breach Earth's magnetosphere.

---

## 📸 System Previews & Operational Snapshots

### 1. High-Confidence Geomagnetic Storm Event
*When a severe solar anomaly hits the system, the ML pipeline tracks the sustained pressure while the 3D magnetosphere shield scales and pulses dynamically to reflect physical compression.*

![High-Confidence G5 Storm Simulation](./screenshots/storm_simulation_active.jpg)

### 2. Historical Failsafe & ML Discrepancy Detection
*An operational view showing the 'Historical Context' panel active. When the Machine Learning model underpredicts a threat but raw telemetry matches a past disaster, the Weighted Manhattan Distance algorithm triggers a Red Failsafe Banner.*

![ML Discrepancy Failsafe Banner](./screenshots/failsafe_discrepancy_active.jpg)

---

## 🛠️ Core Architecture & Data Flow

Aegis is engineered as a highly decoupled microservice architecture running inside localized Docker containers to isolate ingestion overhead from user-facing API routes.

![System Workflow Diagram](./screenshots/workflow_diagram.png)

1. **Data Ingestion Worker (`ingestion.py`)**: Continuously fetches live, high-frequency L1 satellite plasma and magnetic json streams from NOAA SWPC. It resamples 1-minute streams into clean 5-minute temporal blocks, handles missing sensor metrics via linear interpolation, and calculates physical particle travel delay.
2. **Machine Learning Inference**: Implements an optimized Random Forest model utilizing custom-engineered 1-hour, 3-hour, and 6-hour lag features (`Bz_lag6`, `Flow_Speed_lag1`) alongside rolling windows (`Speed_Mean_6h`) to provide stateless trees with temporal memory context.
3. **Database Layer (PostgreSQL)**: Acts as the persistent storage engine, managing live wind snapshots, predictive timelines, and a curated database of verified historical space anomalies.
4. **FastAPI Gateway (`api.py`)**: Serves high-speed REST endpoints, merging live predictions with timelines and driving the mathematical comparison engine.
5. **Similarity Engine (`similarity_engine.py`)**: A deterministic failsafe that transforms incoming live telemetry into a physics vector $[Kp, B_z, \text{Speed}, \text{Density}]$ and runs a strict **Weighted Manhattan Distance** calculation against past disasters to verify AI model integrity.
6. **React Frontend (`App.jsx`)**: Built with React, WebGL (`react-globe.gl` / `Three.js`), and Tailwind CSS to output a low-latency, mission-control dashboard.

---

## 🚀 Tech Stack

* **Frontend**: React.js, Three.js, React-Globe.gl, Recharts, Tailwind CSS
* **Backend**: Python 3.10, FastAPI, Scikit-Learn, Joblib, Pandas, NumPy
* **Database**: PostgreSQL 15 + `psycopg2`
* **DevOps**: Docker, Docker Compose

---
