import subprocess
import os
import sys
import threading
import time
from datetime import datetime

# Set working directory to the script's directory
# This ensures it's running in the same context as server.js
os.chdir(os.path.dirname(os.path.abspath(__file__)))

def log(message, level="INFO"):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Clean up the message for cleaner output
    msg = str(message).strip()
    if not msg:
        return
    print(f"[{timestamp}] [{level}] {msg}")

def stream_output(pipe, level):
    """
    Reads from the subprocess pipe in a separate thread and logs output line by line.
    """
    for line in iter(pipe.readline, ''):
        if line:
            clean_line = line.strip()
            # Intelligent labeling based on console output content
            if "error" in clean_line.lower() or "exception" in clean_line.lower() or "failed" in clean_line.lower():
                log(clean_line, level="ERROR")
            elif "warn" in clean_line.lower():
                log(clean_line, level="WARN")
            elif "listening" in clean_line.lower() or "success" in clean_line.lower():
                log(clean_line, level="SYSTEM")
            else:
                log(clean_line, level=level)
    pipe.close()

def run_server():
    log("=========================================", level="BOOT")
    log("    RMC WEB APP - MASTER LAUNCHER        ", level="BOOT")
    log("=========================================", level="BOOT")
    log("Loading Node.js environment...", level="SYSTEM")
    
    # Ensure port 8080 environment variable is set for consistency
    env = os.environ.copy()
    env["PORT"] = "8080"
    # To facilitate insecure login on localhost without HTTPS
    env["ALLOW_INSECURE_SESSION"] = "true"
    
    try:
        # Start the Node.js process using Popen
        # We use shell=True on Windows to handle any potential shell commands properly
        # But we'll try direct first for speed and reliability
        process = subprocess.Popen(
            ["node", "server.js"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
            encoding='utf-8',
            errors='replace'
        )
        
        log(f"Node.js server process spawned (PID: {process.pid})", level="SYSTEM")
        log("Listening for server events... Press Ctrl+C to terminate.", level="SYSTEM")

        # Monitoring threads
        stdout_thread = threading.Thread(target=stream_output, args=(process.stdout, "SERVER"), daemon=True)
        stderr_thread = threading.Thread(target=stream_output, args=(process.stderr, "ERR"), daemon=True)
        
        stdout_thread.start()
        stderr_thread.start()

        # Keep main thread alive while process is running
        while process.poll() is None:
            time.sleep(1)
            
        exit_code = process.returncode
        log(f"Server process terminated with exit code: {exit_code}", level="SYSTEM")
        
    except FileNotFoundError:
        log("Node.js ('node') executable not found. Is it installed?", level="FATAL")
    except KeyboardInterrupt:
        log("Shutting down master launcher...", level="SYSTEM")
        process.terminate()
        try:
            process.wait(timeout=3)
        except:
            process.kill()
    except Exception as e:
        log(f"Unexpected launcher error: {str(e)}", level="FATAL")
    finally:
        log("Launcher session finished.", level="SYSTEM")

if __name__ == "__main__":
    run_server()
