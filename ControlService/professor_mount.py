"""Optional PC-loopback-only mount of the existing Professor build/API."""
import http.client
import re
from pathlib import Path
from urllib.parse import urlsplit
from content_catalog import ContentError


def require(ok, message, status=400):
    if not ok:
        raise ContentError(status, message)


def serve(handler, method, *, loopback):
    path = urlsplit(handler.path).path
    if not (path.startswith('/professor/') or path.startswith('/api/school')):
        return False
    root = getattr(handler.server, 'professor_ui', None)
    require(root is not None, 'Professor mount is not configured on this PC', 503)
    require(handler.server.is_loopback and loopback(handler.client_address[0]), 'Professor mount is PC-loopback only', 403)
    handler.authenticate()
    origin = handler.headers.get('Origin')
    require(origin is None or origin.lower() == handler.server.scheme + '://' + handler.headers.get('Host', '').lower(),
            'Cross-origin Professor access rejected', 403)
    require(handler.headers.get('Sec-Fetch-Site') in (None, 'same-origin', 'none'), 'Cross-site Professor access rejected', 403)
    if path.startswith('/professor/'):
        require(method == 'GET' and not urlsplit(handler.path).query, 'Invalid Professor build request')
        relative = path[len('/professor/'):]
        require(relative == '' or re.fullmatch(r'assets/[A-Za-z0-9._-]+\.(?:js|css|png|svg|woff2?)', relative),
                'Unknown Professor build asset', 404)
        file = Path(root) / (relative or 'index.html')
        require(file.is_file() and not file.is_symlink(), 'Build the existing Professor UI first', 404)
        data = file.read_bytes()
        content_type = ('text/html; charset=utf-8' if not relative else
                        'text/javascript; charset=utf-8' if file.suffix == '.js' else
                        'text/css; charset=utf-8' if file.suffix == '.css' else 'application/octet-stream')
        handler.send_response(200)
        handler.send_header('Content-Type', content_type)
        handler.send_header('Content-Length', str(len(data)))
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('X-Content-Type-Options', 'nosniff')
        # Scoped to this local, same-origin child; normal Matrix policy is unchanged.
        handler.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'self'")
        handler.end_headers(); handler.wfile.write(data)
        return True
    body = None
    if method == 'POST':
        require(handler.headers.get_content_type() == 'application/json', 'JSON body required', 415)
        require(not handler.headers.get('Transfer-Encoding'), 'Transfer encoding is unsupported')
        try:
            size = int(handler.headers.get('Content-Length', '-1'))
        except ValueError:
            raise ContentError(400, 'Invalid Professor body size') from None
        limit = 720000 if re.fullmatch(r'/api/school/sessions/[a-f0-9-]{36}/spoken-message', path) else 12000
        require(0 < size <= limit, 'Professor body is too large', 413)
        body = handler.rfile.read(size)
        require(len(body) == size, 'Incomplete Professor body')
    port = getattr(handler.server, 'professor_port', 3108)
    require(port in (3108, 3110), 'Unsupported local Professor port', 503)
    upstream_origin = 'http://127.0.0.1:' + str(port)
    headers = {'Host': '127.0.0.1:' + str(port), 'Sec-Fetch-Site': 'same-origin'}
    if method == 'POST':
        headers.update({'Content-Type': 'application/json', 'Origin': upstream_origin})
    owner = re.search(r'(?:^|;\s*)(sota-local-learner=[a-f0-9]{64})(?:;|$)', handler.headers.get('Cookie', ''))
    if owner:
        headers['Cookie'] = owner[1]
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=150)
    try:
        connection.request(method, handler.path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read(4 * 1024 * 1024 + 1)
        require(len(data) <= 4 * 1024 * 1024 and 'application/json' in response.getheader('Content-Type', ''),
                'Professor returned an invalid local API response', 502)
        handler.send_response(response.status)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(data)))
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('X-Content-Type-Options', 'nosniff')
        saved_cookie = response.getheader('Set-Cookie', '')
        if re.fullmatch(r'sota-local-learner=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=/api/school; Max-Age=31536000', saved_cookie):
            handler.send_header('Set-Cookie', saved_cookie)
        handler.end_headers(); handler.wfile.write(data)
    except (OSError, http.client.HTTPException):
        raise ContentError(503, 'The configured loopback Professor server is unavailable') from None
    finally:
        connection.close()
    return True
