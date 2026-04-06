"""
Vercel serverless entry point for Nature's Understory dashboard.
Wraps the Flask app for Vercel's Python runtime.
"""
import os
import sys
import logging
from datetime import datetime, timezone

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, render_template, request as flask_request
from analyzer import (
    build_hourly_analysis,
    payments_to_dataframe,
)
from clover_client import build_clients_from_config
from homebase_client import build_labor_source
import main # Import for logic sharing

app = Flask(__name__, template_folder="../templates")

# Initialize clients lazily or on startup
# On Vercel, we rely on environment variables directly.
# bws_loader is used locally; Vercel should have them in the Dashboard.

def get_config():
    # Minimal config for serverless
    return {
        "merchants": [
            {"id": "NATURES_STOREHOUSE", "name": "Nature's Storehouse"}
        ],
        "labor": {
            "loaded_cost_multiplier": 1.2
        },
        "analysis": {
            "min_daily_sales_threshold": 0.01
        }
    }

@app.route("/")
def index():
    return render_template("dashboard.html")

@app.route("/store_status")
def store_status():
    config = get_config()
    clients = build_clients_from_config(config, os.environ)
    days = int(flask_request.args.get("days", 90))
    local_tz = flask_request.args.get("tz", "America/New_York")
    
    results = {}
    for cid, client in clients.items():
        merchant_name = next((m["name"] for m in config["merchants"] if m["id"] == cid), cid)
        payments = list(client.fetch_payments_last_n_days(days=days))
        if not payments:
            continue
        hourly = build_hourly_analysis(payments, lookback_days=days, local_tz=local_tz)
        results[cid] = {
            "name": merchant_name,
            "hourly": hourly,
            "raw_df": payments_to_dataframe(payments),
            "local_tz": local_tz
        }
    
    payload = main._build_store_payload(results, days_window=days)
    return jsonify(payload)

@app.route("/labor_data")
def labor_data():
    config = get_config()
    clients = build_clients_from_config(config, os.environ)
    labor_source = build_labor_source(config, os.environ)
    
    days = int(flask_request.args.get("days", 30))
    multiplier = float(flask_request.args.get("multiplier", 1.2))
    local_tz = flask_request.args.get("tz", "America/New_York")
    
    now = datetime.now(timezone.utc)
    start = now - main.timedelta(days=days)
    end = now + main.timedelta(days=7)
    
    payload = main._fetch_labor_payload(
        labor_source, clients, False, local_tz, start, end, multiplier, config
    )
    return jsonify(payload)

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "app": "natures-understory"})

# Note: /api/refresh and cache_status are disabled in serverless mode 
# as there is no persistent writable disk for the cache files.
