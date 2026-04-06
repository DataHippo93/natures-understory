"""
Vercel serverless entry point for Nature's Understory dashboard.
Wraps the Flask app for Vercel's Python runtime.
"""
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, render_template, request as flask_request

app = Flask(__name__, template_folder="../templates")

@app.route("/")
def index():
    return render_template("dashboard.html")

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "app": "natures-understory"})
