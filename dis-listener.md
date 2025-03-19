# dis-listener
dis-listener is a DIS6 receiver capable of receiving and decoding DIS6 (1998) messages. \
Only message type `Entity State PDU` is supported for now.

## Features
- Can listen to a unicast, multicast and broadcast IPv4 address
- Displays message datetime and size
- Optional output to a log file
- Decodes DIS6 Entity State PDU
  - Entity Type
  - Entity ID
  - Marking
  - Position in lat/long/alt
  - Orientation in Yaw/Pitch/Roll
  - Damage from appearance
  - Articulation Parameters
    - Displays value in hex
    - Also ecodes Entity ID if the Articulation Parameter is of type `Entity ID list`
- SEA for zero-install usage, without a node.js runtme

## Usage
### Node version (requires nodejs 22+ installed)
```sh
Usage: node dis-listener.js <disAddress> <disPort> [filename] [-v]

disAddress: The DIS IP address to listen on.
            Unicast, multicast and broadcast IPv4 adresses are allowed.
disPort: The port to listen on.
filename: The output file to write logs to.

Example:
  node dis-listener.js 239.1.2.3 62040
```
### Exe (SEA) version for Windows
```sh
Usage: dis-listener.exe <disAddress> <disPort> [filename] [-v]

disAddress: The DIS IP address to listen on.
            Unicast, multicast and broadcast IPv4 adresses are allowed.
disPort: The port to listen on.
filename: The output file to write logs to.

Example:
  dis-listener.exe 239.1.2.3 62040
```

## Remarks
- Logging to file will append to an existing file if any
- Since the app is not signed (exe file), Windows might trigger a SmartScreen warning, you can bypass it by clicking on the button in the text. 
- Windows might ask the user to allow the app to communicate with other networks, it is necessary to  to work on LAN/WAN etc..
- `(node:36980) ExperimentalWarning` at start is normal

## License
The complete source code and any potential binaries are governed by a proprietary license from PROLEXIA. Any use or reuse of these components is strictly limited and requires explicit approval from PROLEXIA.