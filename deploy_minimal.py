import sys, os, subprocess

sys.path.insert(0, '/home/adkadmin/.openclaw/workspace/scripts')
import bws_loader

def run_deploy():
    secrets = bws_loader.load_all()
    token = secrets.get('VERCEL_TOKEN', '')
    if not token:
        print("VERCEL_TOKEN not found in secrets.")
        return

    def run_vercel(args):
        base = ["vercel"] + args + ["--token", token]
        return subprocess.run(base)

    print("Linking...")
    run_vercel(["link", "--yes"])
    
    print("Setting mid...")
    v = secrets.get("NATURES_STOREHOUSE_MID", "")
    subprocess.run(f"printf '%s' '{v}' | vercel env add NATURES_STOREHOUSE_MID production --force --token {token}", shell=True)
    
    print("Setting token...")
    v = secrets.get("NATURES_STOREHOUSE_TOKEN", "")
    subprocess.run(f"printf '%s' '{v}' | vercel env add NATURES_STOREHOUSE_TOKEN production --force --token {token}", shell=True)
    
    print("Setting hb key...")
    v = secrets.get("HOMEBASE_API_KEY", "")
    subprocess.run(f"printf '%s' '{v}' | vercel env add HOMEBASE_API_KEY production --force --token {token}", shell=True)
    
    print("Setting hb loc...")
    v = secrets.get("HOMEBASE_LOCATION_ID", "")
    subprocess.run(f"printf '%s' '{v}' | vercel env add HOMEBASE_LOCATION_ID production --force --token {token}", shell=True)

    print("Deploying...")
    run_vercel(["deploy", "--prod", "--yes"])

if __name__ == "__main__":
    run_deploy()
