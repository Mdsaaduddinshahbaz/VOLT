import subprocess
import sys

celery = subprocess.Popen([
    "celery",
    "-A", "redis_db.celery",
    "worker",
    "--loglevel=info",
    "--pool=solo"
])

server = subprocess.Popen([
    sys.executable,
    "server.py"
])

try:
    celery.wait()
    server.wait()
except KeyboardInterrupt:
    print("\nStopping application...")

    celery.terminate()
    server.terminate()

    celery.wait()
    server.wait()