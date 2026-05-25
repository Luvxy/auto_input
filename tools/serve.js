const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

const clients = new Set();

function encodeFrame(message) {
  const payload = Buffer.from(message);
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) {
    return null;
  }

  let offset = 2;
  let length = buffer[1] & 0x7f;

  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const masked = Boolean(buffer[1] & 0x80);
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += masked ? 4 : 0;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return payload.toString("utf8");
}

function broadcast(sender, message) {
  const frame = encodeFrame(message);
  for (const client of clients) {
    if (client !== sender && !client.destroyed) {
      client.write(frame);
    }
  }
}

const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(root, requestedPath));

    if (!filePath.startsWith(root)) {
      send(res, 403, "Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        send(res, 404, "Not found");
        return;
      }

      send(res, 200, data, types[path.extname(filePath)] || "application/octet-stream");
    });
  });

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n")
  );

  clients.add(socket);
  socket.write(encodeFrame(JSON.stringify({ type: "bridge-ready", clients: clients.size })));

  socket.on("data", (buffer) => {
    const message = decodeFrame(buffer);
    if (message) {
      broadcast(socket, message);
    }
  });

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

server.listen(port, () => {
    console.log(`MVP app running at http://localhost:${port}`);
    console.log(`WebSocket bridge running at ws://localhost:${port}/ws`);
  });
