#!/bin/bash
set -e

# This script runs on first container startup (empty data volume).
# Creates:
#   1. retailedge_test database (alongside retailedge_dev)
#   2. retailedge_app role (non-superuser for RLS enforcement)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create test database
    CREATE DATABASE retailedge_test;

    -- Create a non-superuser role for the application.
    -- Superusers bypass RLS, so the app must connect as a regular user.
    CREATE ROLE retailedge_app WITH LOGIN PASSWORD 'retailedge_app_dev';

    -- Grant permissions on dev database
    GRANT ALL PRIVILEGES ON DATABASE retailedge_dev TO retailedge_app;
    GRANT ALL ON SCHEMA public TO retailedge_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO retailedge_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO retailedge_app;
EOSQL

# Grant permissions on test database (need to connect to it specifically)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "retailedge_test" <<-EOSQL
    GRANT ALL PRIVILEGES ON DATABASE retailedge_test TO retailedge_app;
    GRANT ALL ON SCHEMA public TO retailedge_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO retailedge_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO retailedge_app;
EOSQL

echo "Databases and app role created successfully"
