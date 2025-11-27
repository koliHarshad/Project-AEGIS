# 1. Use a lightweight Linux with Python pre-installed
FROM python:3.9-slim

# 2. Prevent Python from creating .pyc files (useless in containers)
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 3. Set the "Working Directory" inside the container
WORKDIR /app

# 4. Copy the list of libraries we need
COPY requirements.txt .

# 5. Install the libraries
# We add "libpq-dev" and "gcc" because psycopg2 (Postgres driver) needs them to build
RUN apt-get update && apt-get install -y \
    libpq-dev gcc \
    && pip install --no-cache-dir -r requirements.txt

# 6. Copy the rest of your code into the container
COPY . .

# 7. Default command (We will override this in docker-compose)
CMD ["python", "src/ingestion.py"]