import dgram from 'node:dgram';
import {
  DIS6_PduFactory as PduFactory,
  DIS6_EntityStatePdu,
  DIS6_SurfacePlatformAppearance,
  DIS6_EntityID,
  InputStream,
  CoordinateConverter,
  OrientationConverter
} from 'open-dis-js';

import { isInSubnet } from 'is-in-subnet';
import packageJson from './package.json' with { type: "json" };
import { createWriteStream } from 'node:fs';
import { isSea } from 'node:sea';

// check if the app is a Single executable application
const isSEA = isSea();

const NAME = 'DISListener';
const FILENAME = 'dis-listener' + (isSEA ? '.exe' : '.js');

const orc = new OrientationConverter();

/** 
 * @typedef {Object} DISListenerConfig
 * @property {string} [disAddress] - The DIS IP address to listen on. Default is '239.1.2.3'
 * @property {number} [disLocalAddress] - The local address to listen on. Default is '0.0.0.0'
 * @property {number} [disPort] - The port to listen on. Default is 62040
 */

// get parameters from args
const args = process.argv.slice(2);

// min args length is 2
if (args.length < 2) {
  const nodePrefix = "node ";

  console.log(`Usage: ${isSEA ? "":nodePrefix}${FILENAME} <disAddress> <disPort> [filename] [-v]`);
  console.log('');
  console.log('disAddress: The DIS IP address to listen on. It can be a multicast address (subnet 224.0.0.0/4).');
  console.log('disPort: The port to listen on.');
  console.log('filename: The output file to write logs to.');
  console.log('');
  console.log('Example:');
  console.log(`  ${isSEA ? "":nodePrefix}${FILENAME} 239.1.2.3 62040 -v`);
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
const FILE_OUTPUT = argsf[2];

// check -v flag for verbose logging
//const VERBOSE = argsp.includes('-v');
const VERBOSE = true;

class DISListener {
  version = packageJson.version;
  pduFactory = new PduFactory();
  coordConverter = new CoordinateConverter();

  /** @type {DISListenerConfig} */
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

  /** @type {Stream} */
  logStream = null;

  /**
   * @param {DISListenerConfig} config
   */
  constructor(config) {
    this.setConfig(config);
  }

  start() {
    this.initLogging();
    this.listenForUDP();

    this.log(DISListener.LOG_LEVEL.INFO, `${NAME} v${this.version} started`);
  }

  initLogging() {
    // Check if the output file is set
    if (FILE_OUTPUT) {
      this.logStream = createWriteStream(FILE_OUTPUT, { flags: 'a' });
    }
  }

  listenForUDP() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('listening', () => {
      const address = this.socket.address();

      this.log(DISListener.LOG_LEVEL.INFO, `Listening for UDP ${this.isMulticast ? "multicast" : ""} on ${this.config.disAddress}:${this.config.disPort}`);

      // Join the multicast group if needed
      if (this.isMulticast) {
        this.log(DISListener.LOG_LEVEL.INFO, `Joining multicast group ${UDP_IP}`);
        this.socket.addMembership(UDP_IP);
      }
    });

    // Event when a message is received
    this.socket.on('message', (msg, rinfo) => {
      console.log(``);
      this.log(DISListener.LOG_LEVEL.VERBOSE, `Received datagram from ${rinfo.address}:${rinfo.port}, length: ${rinfo.size} bytes`);

      this.parseDISMessage(msg);
    });

    // Event when there's an error
    this.socket.on('error', (err) => {
      this.log(DISListener.LOG_LEVEL.ERROR, `Socket error: ${err.message}`);
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

      if (disMessage.pduType === DIS6_EntityStatePdu.pduType) {
        /** @type {DIS6_EntityStatePdu} */
        const espdu = disMessage;

        if (espdu.protocolVersion !== 6) {
          this.log(DISListener.LOG_LEVEL.ERROR, `Unsupported DIS protocol version: ${espdu.protocolVersion}`);
          return;
        }

        // parse the DIS message
        this.handleDIS_ESPDU(espdu);
      }
    }
  }

  /**
   * 
   * @param {DIS6_EntityStatePdu} espdu 
   */
  handleDIS_ESPDU(espdu) {
    // convert entityLocation to lat long
    const pos = this.coordConverter.convertDisToLatLongInDegrees(espdu.entityLocation);

    this.log(DISListener.LOG_LEVEL.VERBOSE, `Received Entity State PDU`);

    // type
    this.log(DISListener.LOG_LEVEL.VERBOSE, `type: ${espdu.entityType.kind}, domain: ${espdu.entityType.domain}, country: ${espdu.entityType.country}, category: ${espdu.entityType.category}, subcategory: ${espdu.entityType.subcategory}, specific: ${espdu.entityType.spec}, extra: ${espdu.entityType.extra}`);

    this.log(DISListener.LOG_LEVEL.VERBOSE, `pos: Lat: ${pos.latitude}, Lon: ${pos.longitude}, Alt: ${pos.altitude}`);

    // translated orientation
    const ort = orc.calculateHeadingPitchRollFromPsiThetaPhiRadians(espdu.entityOrientation, pos.latitude, pos.longitude);
    this.log(DISListener.LOG_LEVEL.VERBOSE, `heading: ${ort.heading}, pitch: ${ort.pitch}, roll: ${ort.roll}`);

    const marking = espdu.marking.getMarking();
    this.log(DISListener.LOG_LEVEL.VERBOSE, `marking: ${marking}`);
    this.log(DISListener.LOG_LEVEL.VERBOSE, `id: ${espdu.entityID}`);

    // appearance
    const appearance = new DIS6_SurfacePlatformAppearance();
    appearance.fromUInt32(espdu.entityAppearance);
    // damage from appearance
    const damage = appearance.damage;
    this.log(DISListener.LOG_LEVEL.VERBOSE, `damage: ${damage}`);

    // articulation parameters
    const aps = espdu.articulationParameters;

    this.log(DISListener.LOG_LEVEL.VERBOSE, `Articulation Parameters (count: ${aps.length}):`);

    let i = 0;
    for (const ap of aps) {
      this.log(DISListener.LOG_LEVEL.VERBOSE, `ap #${i}:`);
      this.log(DISListener.LOG_LEVEL.VERBOSE, `  parameterType: ${ap.parameterType}`);
      this.log(DISListener.LOG_LEVEL.VERBOSE, `  parameterTypeDesignator: ${ap.parameterTypeDesignator}`);
      this.log(DISListener.LOG_LEVEL.VERBOSE, `  parameterValue: 0x${this.toHex(ap.parameterValue)}`);

      // if parametertype is EntityID list
      if (ap.parameterType === 1) {
        // convert parametervalue to EntityID
        const arrbuf = new Uint8Array(ap.parameterValue).buffer;
        //console.log(arrbuf);
        const is = new InputStream(arrbuf);
        const eid = new DIS6_EntityID();
        eid.initFromBinary(is);
        this.log(DISListener.LOG_LEVEL.VERBOSE, `  parameterValue Entity ID decoded:`);
        this.log(DISListener.LOG_LEVEL.VERBOSE, `    site: ${eid.site}`);
        this.log(DISListener.LOG_LEVEL.VERBOSE, `    application: ${eid.application}`);
        this.log(DISListener.LOG_LEVEL.VERBOSE, `    entity: ${eid.entity}`);
      }

      i++;
    }
  }

  toHex(buffer) {
    return Array.prototype.map.call(buffer, x => ('00' + x.toString(16)).slice(-2)).join('');
  }

  /**
   * @param {DISListenerConfig} config
   */
  setConfig(config) {
    this.config = {
      disAddress: config.disAddress ?? '239.1.2.3',
      disPort: config.disPort ?? 62040,
      logLevel: config.logLevel ?? DISListener.LOG_LEVEL.INFO
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

    const prefix = `[${new Date().toISOString()}] [${level}]`;

    // log to stdout
    console.log(prefix, ...messages);
    // log to file if set
    if (this.logStream) {
      this.logStream.write(`${prefix} ${messages.join(' ')}\n`);
    }
  }
}

const proxy = new DISListener({
  disAddress: UDP_IP,
  disPort: UDP_PORT,
  logLevel: VERBOSE ? DISListener.LOG_LEVEL.VERBOSE : DISListener.LOG_LEVEL.INFO,
});
proxy.start();