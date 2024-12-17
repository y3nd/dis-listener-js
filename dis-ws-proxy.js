import dgram from 'dgram';
import { DIS6_PduFactory, CoordinateConverter } from 'open-dis-js';
import { WebSocketServer } from 'ws';

/** 
 * @typedef {Object} DISWSProxyConfig
 * @property {string} [disMulticastAddress] - The DIS multicast IP address to listen on. Default is '239.1.2.3'
 * @property {number} [disLocalAddress] - The local address to listen on. Default is '0.0.0.0'
 * @property {number} [disPort] - The port to listen on. Default is 62040
 * @property {number} [wsHost] - The host to listen on for WebSocket connections. Default is 'localhost'
 * @property {number} [wsPort] - The port to listen on for WebSocket connections. Default is 8080
 * @property {string} [wsPath] - The path to listen on for WebSocket connections. Default is '/'
 */

// get parameters from args
const args = process.argv.slice(2);

const MULTICAST_IP = args[0] || '239.1.2.3';
const PORT = parseInt(args[1], 10) || 62040;

// check -v flag for verbose logging
const VERBOSE = args.includes('-v');

const LOG_LEVEL = {
  VERBOSE: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
}

class DISWSProxy {
  pduFactory = new DIS6_PduFactory();
  coordConverter = new CoordinateConverter();

  /** @type {WebSocketServer} */
  ws = null;

  /** @type {DISWSProxyConfig} */
  config = null;

  /** @type {dgram.Socket} */
  socket = null;
  
  /**
   * @param {DISWSProxyConfig} config
   */
  constructor(config) {
    this.setConfig(config);
  }

  start() {
    this.listenForUDP();
    this.startWSServer();
  }

  startWSServer() {
    this.ws = new WebSocketServer({
      host: this.config.wsHost,
      port: this.config.wsPort,
    });

    this.ws.on('connection', (ws) => {
      this.log(LOG_LEVEL.INFO, `Client connected from ${ws.remoteAddress}:${ws.remotePort}`);
    });

    this.ws.on('error', (err) => {
      this.log(LOG_LEVEL.ERROR, `WebSocket server error: ${err.message}`);
    });

    this.ws.on('close', () => {
      this.log(LOG_LEVEL.INFO, 'WebSocket server closed');
    });

    this.ws.on('listening', () => {
      this.log(LOG_LEVEL.INFO, `WebSocket server listening on ${this.config.wsHost}:${this.config.wsPort}`);
    });

    this.ws.on('message', (msg) => {
      this.log(LOG_LEVEL.VERBOSE, `Received message from client: ${msg}`);
    });
  }

  broadcastToWSClients(msg) {
    // check if ws is running and has clients
    if(this.ws?.clients.size > 0) {
      for(const client of this.ws.clients) {
        client.send(msg);
      }

      this.log(LOG_LEVEL.VERBOSE, `Broadcasted message to ${this.ws.clients.size} clients`);
    }
  }

  listenForUDP() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('listening', () => {
      const address = this.socket.address();
      this.log(LOG_LEVEL.INFO, `Listening for UDP multicast on ${this.config.disMulticastAddress}:${this.config.disPort}`);

      // Join the multicast group
      this.socket.addMembership(MULTICAST_IP);
    });

    // Event when a message is received
    this.socket.on('message', (msg, rinfo) => {
      this.log(LOG_LEVEL.VERBOSE, `Received packet from ${rinfo.address}:${rinfo.port}, Length: ${rinfo.size} bytes`);
    });

    // Event when there's an error
    this.socket.on('error', (err) => {
      this.log(LOG_LEVEL.ERROR, `Socket error: ${err.message}`);
      this.socket.close();
    });

    // Bind to the port
    this.socket.bind(this.config.disPort, this.config.disLocalAddress);
  }

  /**
   * @param {DISWSProxyConfig} config
   */
  setConfig(config) {
    this.config = {
      disMulticastAddress: config.disMulticastAddress ?? '239.1.2.3',
      disPort: config.disPort ?? 62040,
      wsHost: config.wsHost ?? 'localhost',
      wsPort: config.wsPort ?? 8080,
      wsPath: config.wsPath ?? '/'
    };
  }

  getConfig() {
    return this.config;
  }

  log(level, message) {
    if(level === LOG_LEVEL.VERBOSE && !VERBOSE) {
      return;
    }

    console.log(`${message}`);
  }
}

const proxy = new DISWSProxy({
  disMulticastAddress: MULTICAST_IP,
  disPort: PORT
});
proxy.start();