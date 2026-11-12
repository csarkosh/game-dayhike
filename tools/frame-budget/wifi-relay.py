#!/usr/bin/python3
"""A phone's adb over Wi-Fi, from a terminal macOS will not let onto the local network.

macOS's Local Network privacy refuses a third-party program's connection to an address on the
local network unless the app responsible for it has been allowed, and says so only as "No route
to host" (EHOSTUNREACH). In a terminal whose processes are their own responsible process (one
started by a launchd agent rather than by an app the user allowed), no prompt is ever shown and
`adb connect <phone>:5555` fails that way, as does node. The programs that ship with macOS are
not subject to it: `/usr/bin/nc`, `/usr/bin/perl` and `/usr/bin/python3` reach the phone.

So this relay, which must be run by the system's own interpreter (`/usr/bin/python3`, not a
pyenv or Homebrew one), listens on this machine's loopback and carries each connection to the
phone. The loopback is not the local network, so adb may connect to it:

    adb tcpip 5555                                   # once, over the cable: the phone's adbd listens on Wi-Fi
    /usr/bin/python3 tools/frame-budget/wifi-relay.py 192.168.1.160 &
    adb connect 127.0.0.1:5560
    export ANDROID_SERIAL=127.0.0.1:5560             # every adb call of the harness goes over Wi-Fi
    adb forward tcp:9222 localabstract:chrome_devtools_remote

The phone's address is `adb shell ip -f inet addr show wlan0`. The README's "The phone" says
the rest (keeping the phone awake off the cable, and closing the port again with `adb usb`).
"""
import socket
import sys
import threading


def pipe(source: socket.socket, sink: socket.socket) -> None:
    """Copies source to sink until either end closes, then closes both."""
    try:
        while True:
            data = source.recv(65536)
            if not data:
                break
            sink.sendall(data)
    except OSError:
        pass
    finally:
        for s in (source, sink):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: /usr/bin/python3 wifi-relay.py <phone address> [phone port 5555] [local port 5560]", file=sys.stderr)
        return 2
    phone = sys.argv[1]
    phone_port = int(sys.argv[2]) if len(sys.argv) > 2 else 5555
    local_port = int(sys.argv[3]) if len(sys.argv) > 3 else 5560
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", local_port))
    listener.listen(8)
    print(f"relaying 127.0.0.1:{local_port} to {phone}:{phone_port}", flush=True)
    while True:
        client, _ = listener.accept()
        try:
            upstream = socket.create_connection((phone, phone_port), timeout=10)
        except OSError as error:
            print(f"the phone did not answer at {phone}:{phone_port}: {error}", flush=True)
            client.close()
            continue
        upstream.settimeout(None)
        for s in (client, upstream):
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()


if __name__ == "__main__":
    sys.exit(main())
