import dgram from 'dgram';
import {
  DIS6_PduFactory as PduFactory,
  DIS6_EntityType,
  DIS6_EntityStatePdu,
  DIS6_SubsurfacePlatformAppearance,
  DIS6_SurfacePlatformAppearance,
  CoordinateConverter
} from 'open-dis-js';

import { WebSocketServer } from 'ws';

import packageJson from './package.json' with { type: "json" };

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

// min args length is 2
if(args.length < 2) {
  console.log('Usage: node dis-ws-proxy.js <disMulticastAddress> <disPort> [wsHost] [wsPort] [-v]');
  console.log('');
  console.log('Options:');
  console.log('  -v  Enable verbose logging');
  console.log('');
  console.log('Example:');
  console.log('  node dis-ws-proxy.js 239.1.2.3 62040 -v');
  console.log('');
  process.exit(1);
}

// get multicast address and port from args
const UDP_MULTICAST_IP = args[0];
const UDP_PORT = parseInt(args[1]);

const WS_HOST = (!args[2].startsWith('-')) ? args[2] : 'localhost';
const WS_PORT = (!args[2].startsWith('-')) ? parseInt(args[3]) : 9870;

// check -v flag for verbose logging
const VERBOSE = args.includes('-v');

class DISWSProxy {
  version = packageJson.version;
  pduFactory = new PduFactory();
  coordConverter = new CoordinateConverter();

  /** @type {WebSocketServer} */
  ws = null;

  /** @type {DISWSProxyConfig} */
  config = null;

  /** @type {dgram.Socket} */
  socket = null;

  static LOG_LEVEL = {
    VERBOSE: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  }
  
  /**
   * @param {DISWSProxyConfig} config
   */
  constructor(config) {
    this.setConfig(config);
  }

  start() {
    this.listenForUDP();
    this.startWSServer();

    this.log(DISWSProxy.LOG_LEVEL.INFO, `DIS-WS Proxy v${this.version} started`);
  }

  startWSServer() {
    this.ws = new WebSocketServer({
      host: this.config.wsHost,
      port: this.config.wsPort,
    });

    this.ws.on('connection', (ws, req) => {
      this.log(DISWSProxy.LOG_LEVEL.INFO, `Client connected from ${req.socket.remoteAddress}:${req.socket.remotePort}`);
    });

    this.ws.on('error', (err) => {
      this.log(DISWSProxy.LOG_LEVEL.ERROR, `WebSocket server error: ${err.message}`);
    });

    this.ws.on('close', () => {
      this.log(DISWSProxy.LOG_LEVEL.INFO, 'WebSocket server closed');
    });

    this.ws.on('listening', () => {
      this.log(DISWSProxy.LOG_LEVEL.INFO, `WebSocket server listening on ${this.config.wsHost}:${this.config.wsPort}`);
    });

    this.ws.on('message', (msg) => {
      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `Received message from client: ${msg}`);
    });
  }

  broadcastToWSClients(msg) {
    // check if ws is running and has clients
    if(this.ws?.clients.size > 0) {
      for(const client of this.ws.clients) {
        client.send(msg);
      }

      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `Broadcasted message to ${this.ws.clients.size} client(s)`);
    }
  }

  listenForUDP() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('listening', () => {
      const address = this.socket.address();
      this.log(DISWSProxy.LOG_LEVEL.INFO, `Listening for UDP multicast on ${this.config.disMulticastAddress}:${this.config.disPort}`);

      // Join the multicast group
      this.socket.addMembership(UDP_MULTICAST_IP);
    });

    // Event when a message is received
    this.socket.on('message', (msg, rinfo) => {
      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `Received packet from ${rinfo.address}:${rinfo.port}, Length: ${rinfo.size} bytes`);

      this.parseDISMessage(msg);
    });

    // Event when there's an error
    this.socket.on('error', (err) => {
      this.log(DISWSProxy.LOG_LEVEL.ERROR, `Socket error: ${err.message}`);
      this.socket.close();
    });

    // Bind to the port
    this.socket.bind(this.config.disPort, this.config.disLocalAddress);
  }

  /**
   * 
   * @param {Buffer} msg 
   * @returns 
   */
  parseDISMessage(msg) {
    // Parse the DIS Entity State PDU (basic parsing for demonstration)
    if (msg.length >= 144) { // Minimum length of Entity State PDU
      // convert msg to an array buffer
      const arrayBuf = new Uint8Array(msg).buffer;

      const disMessage = this.pduFactory.createPdu(arrayBuf);

      //this.log(DISWSProxy.LOG_LEVEL.VERBOSE, disMessage);

      if (disMessage.pduType === DIS6_EntityStatePdu.pduType) {
        /** @type {DIS6_EntityStatePdu} */
        const espdu = disMessage;

        if (espdu.protocolVersion !== 6) {
          this.log(DISWSProxy.LOG_LEVEL.ERROR, `Unsupported DIS protocol version: ${espdu.protocolVersion}`);
          return;
        }

        // parse the DIS message
        this.handleDIS_ESPDU(espdu);

        // broadcast message to ws clients
        this.broadcastToWSClients(msg);
      }
    }
    // } else {
    //   this.log(DISWSProxy.LOG_LEVEL.ERROR, `Received packet is not a valid Entity State PDU`);
    // }
  }

  /**
   * 
   * @param {DIS6_EntityStatePdu} espdu 
   */
  handleDIS_ESPDU(espdu) {
    // convert entityLocation to lat long
    const pos = this.coordConverter.convertDisToLatLongInDegrees(espdu.entityLocation);

    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `Lat: ${pos.latitude}, Lon: ${pos.longitude}, Alt: ${pos.altitude}`);

    const marking = espdu.marking.getMarking();
    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `marking: ${marking}`);

    // appearance
    if (espdu.entityType.entityKind === DIS6_EntityType.EntityKind.PLATFORM
      && espdu.entityType.domain === DIS6_EntityType.Domain.SURFACE) {
      const appearance = new DIS6_SurfacePlatformAppearance();
      appearance.fromUInt32(espdu.entityAppearance);

      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `SurfacePlatformAppearance:`, appearance);
    } else if (espdu.entityType.entityKind === DIS6_EntityType.EntityKind.PLATFORM
      && espdu.entityType.domain === DIS6_EntityType.Domain.SUBSURFACE) {
      const appearance = new DIS6_SubsurfacePlatformAppearance();
      appearance.fromUInt32(espdu.entityAppearance);

      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `SubsurfacePlatformAppearance:`, appearance);
    }
  }

  /**
   * @param {DISWSProxyConfig} config
   */
  setConfig(config) {
    this.config = {
      disMulticastAddress: config.disMulticastAddress ?? '239.1.2.3',
      disPort: config.disPort ?? 62040,
      wsHost: config.wsHost ?? 'localhost',
      wsPort: config.wsPort ?? 9870,
      wsPath: config.wsPath ?? '/',
      logLevel: config.logLevel ?? DISWSProxy.LOG_LEVEL.INFO
    };
  }

  getConfig() {
    return this.config;
  }

  log(level, message) {
    // check if verbose logging is enabled
    if(level < this.config.logLevel) {
      return;
    }

    console.log(`${message}`);
  }
}

const proxy = new DISWSProxy({
  disMulticastAddress: UDP_MULTICAST_IP,
  disPort: UDP_PORT,
  logLevel: VERBOSE ? DISWSProxy.LOG_LEVEL.VERBOSE : DISWSProxy.LOG_LEVEL.INFO,
  wsHost: WS_HOST,
  wsPort: WS_PORT
});
proxy.start();