"""Dev server for Red Horizon: serves the project folder with caching
disabled, so edits and freshly rendered sprite sheets always show up on
reload. Works from any current directory."""
import functools, http.server, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8347
handler = functools.partial(NoCache, directory=ROOT)
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
