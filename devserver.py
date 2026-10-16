"""Local dev server for the game folder with caching disabled. Usage: python devserver.py [port]"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript; charset=utf-8',
                      '.html': 'text/html; charset=utf-8'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(os.environ.get('PORT') or (sys.argv[1] if len(sys.argv) > 1 else 8771))
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game')
handler = functools.partial(NoCacheHandler, directory=root)
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
