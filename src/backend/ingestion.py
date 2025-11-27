import psycopg2
import time
import os
import sys

# 1. GET CONFIG FROM DOCKER
# If running locally, default to localhost. If in Docker, these env vars will be set.
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_NAME = os.getenv('DB_NAME', 'aegis_db')
DB_USER = os.getenv('DB_USER', 'aegis_user')
DB_PASS = os.getenv('DB_PASS', 'madscientist')

def test_connection():
    print(f"🔌 Attempting to connect to: {DB_HOST}...")
    try:
        # 2. CONNECT
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASS
        )
        
        # 3. RUN A SIMPLE QUERY
        cur = conn.cursor()
        cur.execute("SELECT version();")
        db_version = cur.fetchone()
        
        print(f"✅ SUCCESS! Connected to Database.")
        print(f"📊 DB Version: {db_version[0]}")
        
        cur.close()
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Connection Failed: {e}")
        return False

if __name__ == "__main__":
    print("--- 🧪 STARTING CONNECTION TESTER ---")
    
    # Keep trying forever (so the container doesn't crash and exit)
    while True:
        test_connection()
        print("Sleeping for 10 seconds...\n")
        time.sleep(10)