import sys
import os
import subprocess
import json

sys.path.insert(0, '/home/adkadmin/.openclaw/workspace/scripts')
import bws_loader

def run_deploy():
    print("Loading secrets from Bitwarden...")
    secrets = bws_loader.load_all()
    
    env = os.environ.copy()
    if 'VERCEL_TOKEN' in secrets:
        env['VERCEL_TOKEN'] = secrets['VERCEL_TOKEN']
        print("VERCEL_TOKEN loaded.")
    
    # 1. Setup Vercel project if needed, or just push env vars
    # We want to make sure CLOVER and HOMEBASE keys are there.
    vercel_vars = {
        "NATURES_STOREHOUSE_MID": secrets.get("NATURES_STOREHOUSE_MID"),
        "NATURES_STOREHOUSE_TOKEN": secrets.get("NATURES_STOREHOUSE_TOKEN"),
        "HOMEBASE_API_KEY": secrets.get("HOMEBASE_API_KEY"),
        "HOMEBASE_LOCATION_ID": secrets.get("HOMEBASE_LOCATION_ID")
    }
    
    print("Deploying to Vercel...")
    # --prod deploys to production
    # --yes skips confirmation
    # We use subprocess.PIPE to capture output
    try:
        # First Link if not linked
        if not os.path.exists('.vercel'):
            print("Linking project...")
            subprocess.run(["vercel", "link", "--yes"], env=env, check=True)
        
        # Set Env Vars
        print("Setting environment variables...")
        for k, v in vercel_vars.items():
            if v:
                # Use 'printf' to avoid issues with special chars and piping to vercel env add
                cmd = f"printf '%s' \"{v}\" | vercel env add {k} production --force"
                subprocess.run(cmd, shell=True, env=env)
        
        # Deploy
        print("Running deployment...")
        result = subprocess.run(["vercel", "deploy", "--prod", "--yes"], 
                                env=env, capture_output=True, text=True)
        print(result.stdout)
        print(result.stderr)
        
    except Exception as e:
        print(f"Deployment failed: {e}")

if __name__ == "__main__":
    run_deploy()
