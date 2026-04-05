from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from src.backend.similarity_engine import matcher

app = FastAPI()

# 1. ALLOW FRONTEND ACCESS
# This allows your React app (localhost:5173) to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. DATABASE CONNECTION
def get_db_connection():
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'db'),
        database=os.getenv('DB_NAME', 'aegis_db'),
        user=os.getenv('DB_USER', 'aegis_user'),
        password=os.getenv('DB_PASS', 'madscientist'),
        cursor_factory=RealDictCursor
    )

# --- ENDPOINTS ---

@app.get("/")
def read_root():
    return {"status": "System Online", "message": "Solar Sentinel Brain is Active"}

@app.get("/telemetry/timestamps_particle")
def get_timestamps():
    """
    Returns a list of available time points for the slider.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Get last 24 hours (288 records roughly)
        cur.execute("SELECT timestamp, speed, impact_time, density, bz, kp_pred FROM solar_wind ORDER BY timestamp DESC LIMIT 288")
        rows = cur.fetchall()
        conn.close()
        # Convert list of dicts to list of strings
        time_particle_data = [
            {
                "timestamp": row['timestamp'],
                "speed": row['speed'],
                "impact_time": row['impact_time'],
                "density": row['density'],
                "bz": row['bz'],
                "kp": row['kp_pred']
                } 
            for row in rows
        ]
        
        return time_particle_data[::-1] # Reverses the list 
    
    except Exception as e:
        print(f"Error: {e}")
        return [] # Return empty list on failure so frontend doesn't crash

@app.get("/telemetry/snapshot")
def get_snapshot(timestamp: str):
    """
    Returns the physics data for a particular time.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM solar_wind WHERE timestamp = %s", (timestamp,))
        row = cur.fetchone()
        conn.close()
        if row:
            return row
        return {} # Return empty object if not found
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    

@app.get("/telemetry/historical_match")
def get_historical_match(speed: float = 400.0, density: float = 5.0, bz: float = 0.0, kp: float = 2.0):
    """
    Finds the closest historical analog using the Similarity Engine.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM historical_storms")
        storms = cur.fetchall()
        conn.close()

        # The live telemetry vector
        live_vector = [kp, bz, speed, density]
        
        results = []
        for storm in storms:
            # The historical storm vector
            hist_vector = [storm['max_kp'], storm['min_bz'], storm['avg_speed'], storm['avg_density']]
            
            # Let the Engine do the heavy mathematical lifting
            sim_percentage = matcher.calculate_similarity(live_vector, hist_vector)

            results.append({
                "storm_name": storm['storm_name'],
                "date": storm['event_date'].strftime('%b %d, %Y'),
                "max_kp": storm['max_kp'],
                "avg_speed": storm['avg_speed'],
                "avg_density": storm['avg_density'],
                "min_bz": storm['min_bz'],
                "similarity_percentage": sim_percentage,
                "impact_summary": storm['impact_summary'],
                "affected_sectors": storm['affected_sectors']
            })

        # Sort from highest similarity to lowest
        results = sorted(results, key=lambda x: x['similarity_percentage'], reverse=True)
        top_comparisons = results[1:4] if len(results) > 1 else []

        return {
            "primary_match": results[0] if results else {},
            "all_historical_storms": top_comparisons
        }

    except Exception as e:
        print(f"Error calculating historical match: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/telemetry/kp_history")
def get_kp_history():
    """
    Fetches the last 24 hours of recorded data (based on the latest database entry), 
    aligning them chronologically for the frontend graph.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Get ML Predictions (anchored to the absolute latest impact_time in the DB)
        cur.execute("""
            SELECT impact_time as time, kp_pred as predicted_kp
            FROM solar_wind
            WHERE impact_time >= (SELECT MAX(impact_time) FROM solar_wind) - INTERVAL '24 HOURS'
            ORDER BY impact_time ASC
        """)
        predictions = cur.fetchall()

        # 2. Get Ground Truth Actuals for that exact same 24-hour window
        cur.execute("""
            SELECT observed_time as time, actual_kp
            FROM ground_truth_kp
            WHERE observed_time >= (SELECT MAX(impact_time) FROM solar_wind) - INTERVAL '24 HOURS'
            ORDER BY observed_time ASC
        """)
        truths = cur.fetchall()
        conn.close()

        # 3. Merge the two timelines
        combined = []
        for p in predictions:
            if p['time']:
                combined.append({
                    "time": p['time'].isoformat(),
                    "predicted_kp": round(p['predicted_kp'], 2),
                    "actual_kp": None # Null because it's a prediction minute
                })

        for t in truths:
            if t['time']:
                combined.append({
                    "time": t['time'].isoformat(),
                    "predicted_kp": None, 
                    "actual_kp": float(t['actual_kp']) # The 3-hour block
                })

        # Sort everything chronologically so the graph draws left-to-right perfectly
        combined.sort(key=lambda x: x['time'])

        return combined

    except Exception as e:
        print(f"Error fetching Kp history: {e}")
        raise HTTPException(status_code=500, detail=str(e))