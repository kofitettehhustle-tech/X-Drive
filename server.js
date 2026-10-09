const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const siteRoot = path.resolve(__dirname);

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webp': 'image/webp'
};

function notFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<h1>404 - File Not Found</h1>');
}

const server = http.createServer((req, res) => {
  console.log(`${new Date().toLocaleTimeString()} - ${req.method} ${req.url}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (error) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(siteRoot, relativePath);
  if (filePath !== siteRoot && !filePath.startsWith(siteRoot + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';
  const supportsRanges = extname === '.mp3' || extname === '.wav';

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      notFound(res);
      return;
    }

    const baseHeaders = { 'Content-Type': contentType };
    if (supportsRanges) baseHeaders['Accept-Ranges'] = 'bytes';

    if (supportsRanges && req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }

      let start;
      let end;
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return;
        }
        start = Math.max(stat.size - suffixLength, 0);
        end = stat.size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : stat.size - 1;
      }

      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
        res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}/`);
  console.log(`📁 Serving files from: ${siteRoot}`);
  console.log('\n🔒 Private access only - accessible from this computer only');
  console.log('\nPress Ctrl+C to stop the server\n');
});
