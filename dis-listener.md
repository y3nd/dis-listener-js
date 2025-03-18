# dis-listener
dis-listener is a DIS6 receiver capable of receiving and decoding DIS6 1998 messages. \
Only message type `Entity State PDU` is supported for now.

## Usage
### Node version (requires nodejs 22+ installed)
```sh
Usage: node dis-listener.js <disAddress> <disPort> [filename] [-v]

disAddress: The DIS IP address to listen on. It can be a multicast address (subnet 224.0.0.0/4).
disPort: The port to listen on.
filename: The output file to write logs to.

Example:
  node dis-listener.js 239.1.2.3 62040 -v
```
### Exe (SEA) version for Windows
```sh
Usage: dis-listener.exe <disAddress> <disPort> [filename] [-v]

disAddress: The DIS IP address to listen on. It can be a multicast address (subnet 224.0.0.0/4).
disPort: The port to listen on.
filename: The output file to write logs to.

Example:
  dis-listener.exe 239.1.2.3 62040 -v
```

## Remarks
- Since the app is not signed (exe file), Windows might trigger a SmartScreen warning, you can bypass it by clicking on the button in the text. 
- Windows might ask the user to allow the app to communicate with other networks, it is necessary to  to work on LAN/WAN etc..

## License
The complete source code and any potential binaries are governed by a proprietary license from PROLEXIA. Any use or reuse of these components is strictly limited and requires explicit approval from PROLEXIA.