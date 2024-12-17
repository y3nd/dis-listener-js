import WebSocket from 'ws';
import {
  DIS6_PduFactory as PduFactory,
  DIS6_EntityType,
  DIS6_EntityStatePdu,
  DIS6_SubsurfacePlatformAppearance,
  DIS6_SurfacePlatformAppearance,
  CoordinateConverter
} from 'open-dis-js';

const pduFactory = new PduFactory();
const coordConverter = new CoordinateConverter();

const WS_HOST = 'localhost';
const WS_PORT = 9870;

// Create a websocket
const ws = new WebSocket(`ws://${WS_HOST}:${WS_PORT}`, {
});

ws.on('error', (err) => {
  console.error(`WebSocket error: ${err.message}`);
  ws.close();
});

ws.on('open', () => {
  console.log(`Connected to WebSocket server ${WS_HOST}:${WS_PORT}`);
});

ws.on('close', () => {
  console.log('WebSocket connection closed');
});

// Event when a message is received
ws.on('message', (msg, isBinary) => {
  console.log(`Received WS message, length: ${msg.byteLength} bytes`);

  // Parse the DIS Entity State PDU (basic parsing for demonstration)
  if (msg.length >= 144) { // Minimum length of Entity State PDU
    // convert msg to an array buffer
    const arrayBuf = new Uint8Array(msg).buffer;

    const disMessage = pduFactory.createPdu(arrayBuf);

    console.log(disMessage);

    if (disMessage.pduType === DIS6_EntityStatePdu.pduType) {
      /** @type {DIS6_EntityStatePdu} */
      const espdu = disMessage;

      if(espdu.protocolVersion !== 6) {
        console.error(`Unsupported DIS protocol version: ${espdu.protocolVersion}`);
        return;
      }
      // convert entityLocation to lat long

      const pos = coordConverter.convertDisToLatLongInDegrees(espdu.entityLocation);

      console.log(`Lat: ${pos.latitude}, Lon: ${pos.longitude}, Alt: ${pos.altitude}`);

      const marking = espdu.marking.getMarking();
      console.log(`marking: ${marking}`);

      // appearance
      if (espdu.entityType.entityKind === DIS6_EntityType.EntityKind.PLATFORM
        && espdu.entityType.domain === DIS6_EntityType.Domain.SURFACE) {
        const appearance = new DIS6_SurfacePlatformAppearance();
        appearance.fromUInt32(espdu.entityAppearance);

        console.log(`SurfacePlatformAppearance:`, appearance);
      } else if (espdu.entityType.entityKind === DIS6_EntityType.EntityKind.PLATFORM
        && espdu.entityType.domain === DIS6_EntityType.Domain.SUBSURFACE) {
        const appearance = new DIS6_SubsurfacePlatformAppearance();
        appearance.fromUInt32(espdu.entityAppearance);

        console.log(`SubsurfacePlatformAppearance:`, appearance);
      }
    }
  } else {
    console.log('Packet too short to be a valid Entity State PDU.');
  }
});

// Event when there's an error
ws.on('error', (err) => {
  console.error(`Socket error: ${err.message}`);
  ws.close();
});