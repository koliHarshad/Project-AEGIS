from datetime import datetime, timedelta
import joblib
import pandas as pd
import psycopg2
import time
import os
import sys
import time

import requests
from utils import process_solar_data

# 1. GET CONFIG FROM DOCKER
# If running locally, default to localhost. If in Docker, these env vars will be set.
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_NAME = os.getenv('DB_NAME', 'aegis_db')
DB_USER = os.getenv('DB_USER', 'aegis_user')
DB_PASS = os.getenv('DB_PASS', 'madscientist')
DB_PORT = os.getenv('DB_PORT', '5435')

# Find the model file relative to THIS script location
current_dir = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(current_dir, '../ml_model/solar_shield_model.pkl')

# 4. API ENDPOINTS
URL_PLASMA = "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json"
URL_MAG = "https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json"

def get_db_connection():
    """Helper to connect to Postgres."""
    return psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASS, port=DB_PORT)

def init_db():
    """
    Runs ONCE at startup. 
    Creates the table and handles 'Database is starting up' errors.
    """
    max_retries = 10
    for i in range(max_retries):
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            # Create table if not exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS solar_wind (
                    timestamp TIMESTAMP PRIMARY KEY,
                    speed REAL,
                    density REAL,
                    bz REAL,
                    bt REAL,
                    kp_pred REAL,
                    impact_time TIMESTAMP
                );
            """)
            conn.commit()
            cursor.close()
            conn.close()
            print("Database infrastructure ready.")
            return
        
        except Exception:
            print(f"Database not started, retrying in 5 seconds...")
            time.sleep(5)

    sys.exit("Failed to connect to the database after several attempts.")

def get_last_timestamp():
    """asks the db: what is the newest data point we have?"""
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(timestamp) From solar_wind;")
        last_time = cursor.fetchone()[0]
        conn.close()
        return last_time
    except Exception:
        return None

def run_pipeline():
    
    print(f"[{datetime.now()}] 🛰️  Contacting NOAA...")
    
    # 1. FETCH & MERGE
    # Fetch plasma and magnetic field data and merge 
    try:
        r_p = requests.get(URL_PLASMA).json()
        r_m = requests.get(URL_MAG).json()
        df_p = pd.DataFrame(r_p[1:], columns=r_p[0])
        df_m = pd.DataFrame(r_m[1:], columns=r_m[0])
        print(f"📊 Rows available in data from Plasma API: {len(df_p)} and magnetic api: {len(df_m)}")
        # Inner join on time_tag ensures we only keep rows where we have BOTH speed and bz
        df = pd.merge(df_p, df_m, on='time_tag')
        print(f"📊 Rows available after fetching the data: {len(df)}")

        # Pre-convert time so we can slice BEFORE processing
        df['timestamp'] = pd.to_datetime(df['time_tag'])
        df = df.set_index('timestamp')

    except Exception as e:
        print(f"❌ API Error: {e}")
        return
    
    # 2. SLICE TO NEW DATA ONLY
    last_saved = get_last_timestamp()

    if last_saved:
        last_saved = pd.to_datetime(last_saved)

        # since we need 6 hours of "previous" data for calculating lags
        buffer_time = last_saved - timedelta(hours=6)

        # then slicing the dataframe not from last saved, but from buffer time i.e., 6 hours before
        df_after_sclicing = df[df.index > buffer_time].copy()

    else:
        # no data in db yet, process all
        df_after_sclicing = df.copy()

    if df_after_sclicing.empty:
        print("No relevent data found. Exiting.")
        return
    
    # 3. PROCESS the data
    # calls the utils file for cleaning the data. making the data ready for ml model
    print("📊 Rows available before processing:", len(df_after_sclicing))
    df_processed = process_solar_data(df_after_sclicing)
    print(f"📊 Rows available after processing: {len(df_processed)}")
    if df_processed.empty:
        print("No data after processing. Exiting.")
        return

    # 4. REEMOVE THE BUFFER data we added for lag features
    if last_saved:
        df_final = df_processed[df_processed.index > last_saved].copy()
    else:
        df_final = df_processed.copy()
    if df_final.empty:
        print("No new data after removing buffer. Database is up to date.")
        return

    if 'Bz_lag6' not in df_final.columns:
        print(f"⚠️ NOT ENOUGH HISTORY for Lags. Needed 6h, got less.")
        print(f"   Skipping Prediction for this batch.")
        return

    # 5. PREDICT Kp INDEX USING THE ML MODEL
    # gives the final dataframe to the ml model for prediction
    model = joblib.load(MODEL_PATH)

    model_cols = [
        'Scalar_B', 'Bz', 'Proton_Density', 'Flow_Speed', 'F10_7',
        'Bz_lag1', 'Bz_lag3', 'Bz_lag6',
        'Flow_Speed_lag1', 'Flow_Speed_lag3', 'Flow_Speed_lag6',
        'Kp_lag1', 'Kp_lag3', 'Kp_lag6',
        'Speed_Mean_6h', 'Bz_Mean_6h', 'Dynamic_Pressure'
    ] # forcing the column order to match exactly what the model saw during training
    
    # predicting kp index
    df_final['kp_pred'] = model.predict(df_final[model_cols])

    # 6. SAVE TO DATABASE
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        query = """
        INSERT INTO solar_wind (timestamp, speed, density, bz, bt, kp_pred, impact_time)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (timestamp) DO UPDATE 
        SET kp_pred = EXCLUDED.kp_pred;
        """

        for index, row in df_final.iterrows():
            cur.execute(query, (
                index,
                float(row['Flow_Speed']),
                float(row['Proton_Density']),
                float(row['Bz']),
                float(row['Scalar_B']),
                float(row['kp_pred']),
                row['Impact_Time']
            ))
    
        conn.commit()
        conn.close()
    
    except Exception as e:
        print(f"failed to save the data. Error: {e}")
        return
    
    # Log the latest prediction to prove it's working
    latest_kp = df_final['kp_pred'].iloc[-1]
    print(f"💾 Saved {len(df_final)} rows. Latest Forecast: Kp {latest_kp:.2f}")

# --- 4. EXECUTION LOOP ---
if __name__ == "__main__":
    print("--- 🛡️ AEGIS INGESTION WORKER STARTED ---", flush=True)
    
    # 1. Initialize Database
    init_db()
    
    # 2. Start the Infinite Loop
    while True:
        try:
            run_pipeline()
        except Exception as e:
            print(f"❌ CRITICAL WORKER FAILURE: {e}", flush=True)
        
        print("zzzz... Sleeping for 10 minutes...", flush=True)
        time.sleep(600)
