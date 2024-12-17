import dgram from 'dgram';
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

const MULTICAST_IP = '239.1.2.3';
const PORT = 62040;

// Create a socket
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

// Event when the socket is ready
socket.on('listening', () => {
  const address = socket.address();
  console.log(`Listening for UDP multicast on ${MULTICAST_IP}:${PORT}`);

  // Join the multicast group
  socket.addMembership(MULTICAST_IP);
});

// Event when a message is received
socket.on('message', (msg, rinfo) => {
  console.log(`Received packet from ${rinfo.address}:${rinfo.port}, Length: ${rinfo.size} bytes`);

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
socket.on('error', (err) => {
  console.error(`Socket error: ${err.message}`);
  socket.close();
});

// Bind to the port
socket.bind(PORT, () => {
  console.log('Socket bound successfully.');
});
