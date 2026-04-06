import sys, os, subprocess

sys.path.insert(0, '/home/adkadmin/.openclaw/workspace/scripts')
import bws_loader

def get_logs():
    secrets = bws_loader.load_all()
    token = secrets.get('VERCEL_TOKEN', '')
    if not token:
        print("VERCEL_TOKEN not found.")
        return

    subprocess.run(["vercel", "logs", "natures-understory.vercel.app", "--token", token], cwd="/home/adkadmin/natures-understory")

if __name__ == "__main__":
    get_logs()
