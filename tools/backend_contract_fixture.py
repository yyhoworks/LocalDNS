"""Loopback fixture and supervisor for FJGLI contract acceptance."""
import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

WORK = Path(sys.argv[1]).resolve()
ROOT = WORK / 'runtime'
assert str(WORK).startswith('/opt/localdns-contract-audit-')
assert ROOT.is_dir() and str(ROOT.resolve()) == str(ROOT)
config = json.loads((ROOT / 'config/localdns.json').read_text())
assert config['api']['http'] == '127.0.0.1:19099'
assert config['dns']['tcp_listen'] == config['dns']['udp_listen'] == '127.0.0.1:2053'
assert not json.loads((ROOT / 'config/settings/route_refresh.json').read_text())['scheduler']['enabled']
for subscription in (ROOT / 'config/subscriptions').glob('*.json'):
    assert all(not row.get('auto_update') for row in json.loads(subscription.read_text()))
counts = {}
process = None
stopping = threading.Event()
log = (WORK / 'core.log').open('ab', buffering=0)


def launch():
    environment = dict(os.environ, LD_PRELOAD=str(ROOT / 'bin/glibc-shim.so'))
    return subprocess.Popen([str(ROOT / 'bin/localdns'), '--root', str(ROOT), '--config', str(ROOT / 'config/localdns.json')],
                            cwd=ROOT, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=log)


def supervise():
    global process
    while not stopping.wait(.1):
        if process.poll() is not None:
            process = launch()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        route = urlsplit(self.path).path
        if route == '/control/status':
            payload = json.dumps({'counts': counts, 'corePid': process.pid,
                                  'root': str(ROOT), 'configFiles': sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'config').rglob('*.json'))}).encode()
            kind = 'application/json'
        else:
            counts[self.path] = counts.get(self.path, 0) + 1
            fixtures = {'/rules/domestic.txt': b'domain:contract.example\ndomain:contract-two.example\n',
                        '/rules/foreign.txt': b'domain:foreign.contract.example\n',
                        '/rules/geoip.txt': b'192.0.2.0/24\n2001:db8::/32\n',
                        '/rules/adguard.txt': b'[Adblock Plus 2.0]\n||ads.contract.example^\n',
                        '/rules/invalid.txt': b'not a valid IP range\n'}
            if route not in fixtures:
                self.send_error(404)
                return
            payload, kind = fixtures[route], 'text/plain'
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


process = launch()
threading.Thread(target=supervise, daemon=True).start()
server = ThreadingHTTPServer(('127.0.0.1', 19096), Handler)


def stop(*_):
    stopping.set()
    threading.Thread(target=server.shutdown, daemon=True).start()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    server.serve_forever()
finally:
    stopping.set()
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)
    server.server_close()
    log.close()
