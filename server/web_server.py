
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


class Place(object):

    def __init__(self, name, place_id, rect=None):
        self.id = place_id
        self.name = name
        self.rect = rect and Rect.from_list(rect) or None

    @property
    def dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'rect': self.rect and self.rect.__dict__ or None}


class Point(object):

    def __init__(self, lng, lat):
        self.lng = lng
        self.lat = lat

    @classmethod
    def from_list(cls, vec):
        return cls(vec[0], vec[1])

    def equals(self, point):
        return self.lng == point.lng and self.lat == point.lat


class Point3D(object):

    def __init__(self, x, y, z):
        self.x = x
        self.y = y
        self.z = z

    @classmethod
    def from_list(cls, vec):
        return cls(vec[0], vec[1], vec[2])

    def equals(self, vec):
        return self.x == vec[0] and self.y == vec[1] and self.z == vec[2]


class Rect(object):

    def __init__(self, top, left, width, height):
        self.top = top
        self.left = left
        self.width = width
        self.height = height

    @classmethod
    def from_list(cls, rect):
        return cls(
            rect[0][0], rect[0][1],
            rect[1][0] - rect[0][0], rect[1][1] - rect[0][1])

    def project(self, rect, point):
        return Point(
            (point.lng - rect.top) / rect.width * self.width + self.top,
            (-point.lat - rect.left) / rect.height * self.height + self.left)


class Player(object):

    def __init__(self, raw):
        zone_id = raw.context[7]
        fp = get(_MAP_INFO_URL.format(zone_id))
        map_data = json.loads(fp.text)['maps'][str(zone_id)]
        identity = json.loads(raw.identity)
        fp.close()

        self.name = identity['name']
        self.updated = True
        self.updates = ['creation']
        self.zone = Place(map_data['map_name'], zone_id, map_data['map_rect'])
        self.region = Place(map_data['region_name'], map_data['region_id'])
        self.continent = Place(map_data['continent_name'],
                               map_data['continent_id'],
                               map_data['continent_rect'])
        self.server = Place(None, identity['world_id'])
        self.position_raw = Point3D.from_list(raw.fAvatarPosition)
        self.position = None
        self.direction = None
        self.update_position(raw.fAvatarPosition, raw.fAvatarFront)
        # self.direction = -(atan2(dir_z, dir_x) * 180 / pi) % 360

        print("Player Created")

    def set_update(self, update):
        self.updates.append(update)
        self.updated = True

    def clear_updates(self):
        self.updated = False
        self.updates = []

    def update_position(self, position, direction):
        dir_x = direction[0]
        dir_z = direction[2]
        pos = Point(position[0] * _MULTIPLIER, position[2] * _MULTIPLIER)
        self.position = self.continent.rect.project(self.zone.rect, pos)
        self.direction = -(atan2(dir_z, dir_x) * 180 / pi) % 360
        self.position_raw = Point3D.from_list(position)
        self.updated = True
        self.updates.append('position')

        print("Position Updated")

    @property
    def json(self):
        return json.dumps({
            'name': self.name,
            'updated': self.updated,
            'updates': self.updates,
            'zone': self.zone.dict,
            'region': self.region.dict,
            'continent': self.continent.dict,
            'server': self.server.dict,
            'position': [self.position.lng, self.position.lat],
            'direction': self.direction})


class Notifier(Thread):
    def __init__(self):
        Thread.__init__(self)
        self.clients = set()
        self.running = True
        self.force_update = False

    def register(self, client):
        self.clients.add(client)
        self.force_update = True

    def unregister(self, client):
        self.clients.remove(client)
        self.force_update = False

    def run(self, ):
        player = None
        memfile = mmap(0, ctypes.sizeof(Link), "MumbleLink")

        # Only check if people are connected
        while _NOTIFIER.running:

            memfile.seek(0)
            data = unpack(Link, memfile.read(ctypes.sizeof(Link)))

            # Sleep until memory file read
            if data.context_len == 0 or not self.clients:
                sleep(1)
                continue

            # Player instantiation or Map change
            if not player or player.zone.id != data.context[7]:
                player = Player(data)

            # Player movement
            elif not player.position_raw.equals(data.fAvatarPosition):
                player.update_position(data.fAvatarPosition, data.fAvatarFront)

            if self.force_update:
                player.set_update('connection')
                self.force_update = False

            # Only send if there is an update to send
            if player.updated:
                for client in self.clients:
                    try:
                        client.write_message(player.json)
                        player.clear_updates()
                    except Exception as e:
                        print(e)
            sleep(0.1)


class WSHandler(websocket.WebSocketHandler):
    def open(self):
        # New connection
        print("Player Connected")
        _NOTIFIER.register(self)

    def on_close(self):
        # Connection closed
        print("Player Disconnected")
        _NOTIFIER.unregister(self)


application = web.Application([
    (r'/ws', WSHandler),
])


if __name__ == "__main__":
    _NOTIFIER = Notifier()
    _NOTIFIER.start()
    httpserver.HTTPServer(application).listen(8080)
    ioloop.IOLoop.instance().start()
    _NOTIFIER.running = False
