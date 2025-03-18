import dgram from 'node:dgram';
import {
  DIS6_PduFactory as PduFactory,
  DIS6_EntityStatePdu,
  DIS6_SurfacePlatformAppearance,
  DIS6_EntityID,
  InputStream,
  CoordinateConverter
} from 'open-dis-js';
import { WebSocketServer } from 'ws';
import { isInSubnet } from 'is-in-subnet';

import packageJson from './package.json' with { type: "json" };

/** 
 * @typedef {Object} DISWSProxyConfig
 * @property {string} [disAddress] - The DIS IP address to listen on. Default is '239.1.2.3'
 * @property {number} [disLocalAddress] - The local address to listen on. Default is '0.0.0.0'
 * @property {number} [disPort] - The port to listen on. Default is 62040
 * @property {number} [wsHost] - The host to listen on for WebSocket connections. Default is 'localhost'
 * @property {number} [wsPort] - The port to listen on for WebSocket connections. Default is 8080
 * @property {string} [wsPath] - The path to listen on for WebSocket connections. Default is '/'
 */

// get parameters from args
const args = process.argv.slice(2);

// min args length is 2
if (args.length < 2) {
  console.log('Usage: node dis-ws-proxy.js <disAddress> <disPort> [wsHost] [wsPort] [-v]');
  console.log('');
  console.log('Options (only at the end):');
  console.log('  -v  Enable verbose logging');
  console.log('');
  console.log('Example:');
  console.log('  node dis-ws-proxy.js 239.1.2.3 62040 -v');
  console.log('');
  process.exit(1);
}

// filter out - flags
const argsf = args.filter(arg => !arg.startsWith('-'));
//console.log("argsf", argsf);
// filter out non - flags
const argsp = args.filter(arg => arg.startsWith('-'));
//console.log("argsp", argsp);

// get address and port from args
const UDP_IP = argsf[0];
const UDP_PORT = parseInt(argsf[1]);

const WS_HOST = argsf[2] ?? 'localhost';
const WS_PORT = argsf[3] ? parseInt(args[3]) : 8080;

// check -v flag for verbose logging
const VERBOSE = argsp.includes('-v');

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

  /** @type {boolean} */
  isMulticast = false;

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
    if (this.ws?.clients.size > 0) {
      for (const client of this.ws.clients) {
        client.send(msg);
      }

      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `Broadcasted message to ${this.ws.clients.size} client(s)`);
    }
  }

  listenForUDP() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('listening', () => {
      const address = this.socket.address();

      this.log(DISWSProxy.LOG_LEVEL.INFO, `Listening for UDP ${this.isMulticast ? "multicast" : ""} on ${this.config.disAddress}:${this.config.disPort}`);

      // Join the multicast group if needed
      if (this.isMulticast) {
        this.log(DISWSProxy.LOG_LEVEL.INFO, `Joining multicast group ${UDP_IP}`);
        this.socket.addMembership(UDP_IP);
      }
    });

    // Event when a message is received
    this.socket.on('message', (msg, rinfo) => {
      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `\n\nReceived packet from ${rinfo.address}:${rinfo.port}, Length: ${rinfo.size} bytes`);

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

    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `[${(new Date()).toISOString()}] Received Entity State PDU:`);

    // type
    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `type: ${espdu.entityType.kind}, domain: ${espdu.entityType.domain}, country: ${espdu.entityType.country}, category: ${espdu.entityType.category}, subcategory: ${espdu.entityType.subcategory}, specific: ${espdu.entityType.spec}, extra: ${espdu.entityType.extra}`);

    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `pos: Lat: ${pos.latitude}, Lon: ${pos.longitude}, Alt: ${pos.altitude}`);

    // translated orientation
    const ort = orientationConverter.calculateHeadingPitchRollFromPsiThetaPhiRadians(espdu.entityOrientation, pos.latitude, pos.longitude);
    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `heading: ${ort.heading}, pitch: ${ort.pitch}, roll: ${ort.roll}`);

    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `heading: ${heading}`);

    const marking = espdu.marking.getMarking();
    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `marking: ${marking}`);
    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `id: ${espdu.entityID}`);

    // appearance
    const appearance = new DIS6_SurfacePlatformAppearance();
    appearance.fromUInt32(espdu.entityAppearance);
    // damage from appearance
    const damage = appearance.damage;
    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `damage: ${damage}`);

    // articulation parameters
    const aps = espdu.articulationParameters;

    this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `Articulation Parameters (count: ${aps.length}):`);

    let i = 0;
    for (const ap of aps) {
      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `ap #${i}:`);
      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `  parameterType: ${ap.parameterType}`);
      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `  parameterTypeDesignator: ${ap.parameterTypeDesignator}`);
      this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `  parameterValue: 0x${this.toHex(ap.parameterValue)}`);

      if (ap.parameterType === 1 && ap.parameterTypeDesignator === 0) {
        // convert parametervalue to EntityID
        const arrbuf = new Uint8Array(ap.parameterValue).buffer;
        //console.log(arrbuf);
        const is = new InputStream(arrbuf);
        const eid = new DIS6_EntityID();
        eid.initFromBinary(is);
        this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `  parameterValue Entity ID decoded:`);
        this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `    site: ${eid.site}`);
        this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `    application: ${eid.application}`);
        this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `    entity: ${eid.entity}`);
        i++;
      }
    }

    // if (espdu.entityType.entityKind === DIS6_EntityType.EntityKind.PLATFORM
    //   && espdu.entityType.domain === DIS6_EntityType.Domain.SURFACE) {
    //   const appearance = new DIS6_SurfacePlatformAppearance();
    //   appearance.fromUInt32(espdu.entityAppearance);

    //   this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `SurfacePlatformAppearance:`, appearance);
    // } else if (espdu.entityType.entityKind === DIS6_EntityType.EntityKind.PLATFORM
    //   && espdu.entityType.domain === DIS6_EntityType.Domain.SUBSURFACE) {
    //   const appearance = new DIS6_SubsurfacePlatformAppearance();
    //   appearance.fromUInt32(espdu.entityAppearance);

    //   this.log(DISWSProxy.LOG_LEVEL.VERBOSE, `SubsurfacePlatformAppearance:`, appearance);
    // }
  }

  toHex(buffer) {
    return Array.prototype.map.call(buffer, x => ('00' + x.toString(16)).slice(-2)).join('');
  }

  /**
   * @param {DISWSProxyConfig} config
   */
  setConfig(config) {
    this.config = {
      disAddress: config.disAddress ?? '239.1.2.3',
      disPort: config.disPort ?? 62040,
      wsHost: config.wsHost ?? 'localhost',
      wsPort: config.wsPort ?? 9870,
      wsPath: config.wsPath ?? '/',
      logLevel: config.logLevel ?? DISWSProxy.LOG_LEVEL.INFO
    };

    // Check if the address is a multicast address (part of 224.0.0.0/4) for IPv4
    this.isMulticast = isInSubnet(this.config.disAddress, "224.0.0.0/4");
  }

  getConfig() {
    return this.config;
  }

  log(level, ...messages) {
    // check if verbose logging is enabled
    if (level < this.config.logLevel) {
      return;
    }

    console.log(`[${new Date().toISOString()}] [${level}]`, ...messages);
  }
}

const proxy = new DISWSProxy({
  disAddress: UDP_IP,
  disPort: UDP_PORT,
  logLevel: VERBOSE ? DISWSProxy.LOG_LEVEL.VERBOSE : DISWSProxy.LOG_LEVEL.INFO,
  wsHost: WS_HOST,
  wsPort: WS_PORT
});
proxy.start();