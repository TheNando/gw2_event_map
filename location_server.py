
from math import atan2, pi
from mmap import mmap
from requests import get
from threading import Thread
from time import sleep

import ctypes

try: import simplejson as json
except ImportError: import json

# http://www.tornadoweb.org/en/stable/
import tornado.httpserver
import tornado.websocket
import tornado.ioloop
import tornado.web

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
        ("context",         ctypes.c_uint32 * int(256/4)), # is actually 256 bytes of whatever
        ("description",     ctypes.c_wchar * 2048)

    ]

def unpack(ctype, buf):
    cstring = ctypes.create_string_buffer(buf)
    ctype_instance = ctypes.cast(ctypes.pointer(cstring), ctypes.POINTER(ctype)).contents
    return ctype_instance

def continent_coords(continent_rect, map_rect, point):
    return (
        ( point[0]-map_rect[0][0])/(map_rect[1][0]-map_rect[0][0])*(continent_rect[1][0]-continent_rect[0][0])+continent_rect[0][0],
        (-point[1]-map_rect[0][1])/(map_rect[1][1]-map_rect[0][1])*(continent_rect[1][1]-continent_rect[0][1])+continent_rect[0][1]
    )

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
        current_map_id = 0
        current_map_data = None
        identity = None

        memfile = mmap(0, ctypes.sizeof(Link), "MumbleLink")

        while True:
            memfile.seek(0)
            data = memfile.read(ctypes.sizeof(Link))
            result = unpack(Link, data)

            # Map change
            if result.context[7] != current_map_id:
                identity = json.loads(result.identity)
                current_map_id = result.context[7]
                fp = get(_MAP_INFO_URL.format(current_map_id))
                current_map_data = json.loads(fp.text)['maps'][str(current_map_id)]
                fp.close()
                current_map_data['world_id'] = identity['world_id']
                current_map_data['map_id'] = current_map_id
                identity.pop('world_id')
                identity.pop('map_id')

            data = {
                'identity': identity,
                'location': current_map_data,
                'face': -(atan2(result.fAvatarFront[2], result.fAvatarFront[0])*180/pi)%360
            }

            if current_map_data:
                data.update({'position': continent_coords(current_map_data['continent_rect'], current_map_data['map_rect'], (result.fAvatarPosition[0]*_MULTIPLIER, result.fAvatarPosition[2]*_MULTIPLIER))})

            output = json.dumps(data)

            for client in self.clients:
                try:
                    client.write_message(output)
                except Exception as e:
                    print(e)
            sleep(0.1)

class WSHandler(tornado.websocket.WebSocketHandler):
    def open(self):
        # New connection
        _NOTIFIER.register(self)

    def on_close(self):
        # Connection closed
        _NOTIFIER.unregister(self)


application = tornado.web.Application([
    (r'/ws', WSHandler),
])


if __name__ == "__main__":
    _NOTIFIER = Notifier()
    _NOTIFIER.start()
    http_server = tornado.httpserver.HTTPServer(application)
    http_server.listen(8888)
    tornado.ioloop.IOLoop.instance().start()
    _NOTIFIER.running = False # As if
