
from math import atan2, pi
from mmap import mmap
from requests import get
from threading import Thread
from time import sleep

import ctypes
import simplejson as json
from tornado import httpserver
from tornado import websocket
from tornado import ioloop
from tornado import web

_MULTIPLIER = 39.3701
_MAP_INFO_URL = "https://api.guildwars2.com/v1/maps.json?map_id={0}"
_NOTIFIER = None


class Link(ctypes.Structure):
    _fields_ = [
        ("uiVersion",       ctypes.c_uint32),
        ("uiTick",          ctypes.c_ulong),
        ("fAvatarPosition", ctypes.c_float * 3),
        ("fAvatarFront",    ctypes.c_float * 3),
        ("fAvatarTop",      ctypes.c_float * 3),
        ("name",            ctypes.c_wchar * 256),
        ("fCameraPosition", ctypes.c_float * 3),
        ("fCameraFront",    ctypes.c_float * 3),
        ("fCameraTop",      ctypes.c_float * 3),
        ("identity",        ctypes.c_wchar * 256),
        ("context_len",     ctypes.c_uint32),
        ("context",         ctypes.c_uint32 * int(256/4)),
        ("description",     ctypes.c_wchar * 2048)]


def unpack(ctype, buf):
    cstring = ctypes.create_string_buffer(buf)
    return ctypes.cast(ctypes.pointer(cstring), ctypes.POINTER(ctype)).contents


def continent_coords(continent_rect, map_rect, point):
    p0, p1 = point[0], point[1]
    m00, m01 = map_rect[0][0], map_rect[0][1]
    m10, m11 = map_rect[1][0], map_rect[1][1]
    c00, c01 = continent_rect[0][0], continent_rect[0][1]
    c10, c11 = continent_rect[1][0], continent_rect[1][1]

    return (
        (p0 - m00) / (m10 - m00) * (c10 - c00) + c00,
        (-p1 - m01) / (m11 - m01) * (c11 - c01) + c01)


class Notifier(Thread):
    def __init__(self):
        Thread.__init__(self)
        self.clients = set()
        self.running = True

    def register(self, client):
        self.clients.add(client)

    def unregister(self, client):
        self.clients.remove(client)

    def run(self, ):
        map_id = 0
        map_data = None
        identity = None

        memfile = mmap(0, ctypes.sizeof(Link), "MumbleLink")

        while True:
            memfile.seek(0)
            data = memfile.read(ctypes.sizeof(Link))
            result = unpack(Link, data)

            # Map change
            if result.context[7] != map_id:
                identity = json.loads(result.identity)
                map_id = result.context[7]
                fp = get(_MAP_INFO_URL.format(map_id))
                map_data = json.loads(fp.text)['maps'][str(map_id)]
                fp.close()
                map_data['world_id'] = identity['world_id']
                map_data['map_id'] = map_id
                identity.pop('world_id')
                identity.pop('map_id')

            data = {
                'identity': identity,
                'location': map_data,
                'face': -(atan2(result.fAvatarFront[2], result.fAvatarFront[0])*180/pi)%360
            }

            if map_data:
                data.update({
                    'position': continent_coords(map_data['continent_rect'], map_data['map_rect'], (result.fAvatarPosition[0]*_MULTIPLIER, result.fAvatarPosition[2]*_MULTIPLIER))})

            output = json.dumps(data)

            for client in self.clients:
                try:
                    client.write_message(output)
                except Exception as e:
                    print(e)
            sleep(0.1)


class WSHandler(websocket.WebSocketHandler):
    def open(self):
        # New connection
        _NOTIFIER.register(self)

    def on_close(self):
        # Connection closed
        _NOTIFIER.unregister(self)


application = web.Application([
    (r'/ws', WSHandler),
])


if __name__ == "__main__":
    _NOTIFIER = Notifier()
    _NOTIFIER.start()
    http_server = httpserver.HTTPServer(application)
    http_server.listen(8888)
    ioloop.IOLoop.instance().start()
    _NOTIFIER.running = False
