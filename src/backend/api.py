from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
from psycopg2.extras import RealDictCursor
import os

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

@app.get("/telemetry/timestamps")
def get_timestamps():
    """
    Returns a list of available time points for the slider.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Get last 24 hours (288 records roughly)
        cur.execute("SELECT timestamp FROM solar_wind ORDER BY timestamp DESC LIMIT 288")
        rows = cur.fetchall()
        conn.close()
        # Convert list of dicts to list of strings
        timestamp = [row['timestamp'] for row in rows]
        
        return timestamp[::-1] # Reverses the list 
    
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