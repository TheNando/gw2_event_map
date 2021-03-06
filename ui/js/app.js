
// !function(ng) {

var MAP_TILES_URL = "https://tiles.guildwars2.com/1/1/{z}/{x}/{y}.jpg",
    MAPS_URL = "https://api.guildwars2.com/v1/maps.json?map_id={m}"
    MAP_FLOOR_URL = "https://api.guildwars2.com/v1/map_floor.json?continent_id={c}&floor={f}",
    EVENTS_URL = "https://api.guildwars2.com/v1/events.json?world_id={w}&map_id={m}",
    EVENT_DETAILS_URL = "https://api.guildwars2.com/v1/event_details.json?event_id={e}",
    FILES_URL = "https://api.guildwars2.com/v1/files.json",
    IMAGES_URL = "https://render.guildwars2.com/file/{sig}/{file}.png";

// Module definition
var app = angular.module('gw2', []);

Storage.prototype.setObject = function(key, value) {
    this.setItem(key, JSON.stringify(value));
}

Storage.prototype.getObject = function(key) {
    var value = this.getItem(key);
    return value && JSON.parse(value);
}

function updateScope() { angular.element($("#map")).scope().$apply() }

var Resources = (function () {
    var _resources = {};

    // Load resource urls
    $.getJSON(FILES_URL, function (data) {
        var item;
        for (item in data) {
            _resources[item] = IMAGES_URL
                .replace("{sig}", data[item].signature)
                .replace("{file}", data[item].file_id);
        }
        _resources.map_vista = "media/vista.png";
    });

    return _resources;
})();

var EventManager = (function () {
    var events = [];

    function createEventMarker (event) {
        var options = {
            color: event.isGroupEvent ? '#ffc000' : '#d1632a',
            opacity: 0.8,
            fillOpacity: 0.4,
            smoothFactor: 0};
        var radius = Math.max(50000, event.radius * 10);

        switch (event.shape) {
        case "sphere":
             return L.layerGroup([
                L.circle(event.location, radius, options)]);
        case "poly":
            return L.layerGroup([
                L.polygon(event.points.map(recalcCoords), options)]);
        default:
            // debugger;
        }
    }

    function displayEvent (event) {
        clearEvents();
        markerLayers.event = createEventMarker(event)
        markerLayers.event.addTo(_map);
        _map.panTo(event.location, {animate: true});
    }

    function clearEvents () {
        // Remove previous events
        if ("event" in markerLayers)
            markerLayers.event.clearLayers();

        if ("lockedEvent" in markerLayers)
            markerLayers.lockedEvent.clearLayers();
    }

    function lockEvent (event) {
        clearEvents();
        markerLayers.lockedEvent = createEventMarker(event);
        markerLayers.lockedEvent.addTo(_map);
    }

    function fetchEvents () {
         return $.getJSON(
            EVENTS_URL.replace("{w}", server).replace("{m}", zone.id));
    }

    function loadEvents (data, textStatus, jqXHR) {
        // for (e in events)
        //      if (events.hasOwnProperty(e))
        //          delete events[e];
        while (events.length > 0)
            events.pop();

        data.events.forEach(function(evt) {
            if (evt.state !== "Active")
                return;

            $.getJSON(
                EVENT_DETAILS_URL
                    .replace("{e}", evt.event_id),
                function (details) {
                    var e = details.events[evt.event_id];
                    var newEvt = {
                        name: e.name
                        , isGroupEvent: e.flags.indexOf("group_event") !== -1
                        , level: e.level
                        , location: recalcCoords(e.location.center)
                        , distance: distanceBetween(
                            playerMarker.getLatLng(),
                            recalcCoords(e.location.center))
                        , shape: e.location.type
                    };

                    if (e.location.type === "sphere")
                        newEvt.radius = e.location.radius;
                    else if (e.location.type === "poly")
                        newEvt.points = e.location.points;

                    events.push(newEvt);
                    updateScope();
            });
        });
    }

    return {
        events: events
        , initialize: initialize
        , lockEvent: lockEvent
        , displayEvent: displayEvent
        , clearEvents: clearEvents
    };
})();

var MapManager = (function () {
    var _map
        , info = { zones: {}, regions: {} }
        , zone = { continent: null, id: null, floor: null,
            map_rect: null, cont_rect: null }
        , events = []
        , server
        , nativeZoom
        , markerLayers = {}
        , playerMarker

    function initialize (options) {
        nativeZoom = options.zoom.native;

        // Setup map
        _map = L.map("map", {
            minZoom: options.zoom.min
            , maxZoom: options.zoom.max
            , zoom: options.zoom.default
            , center: options.center
            , layers: [L.tileLayer(MAP_TILES_URL, {
                minZoom: options.zoom.min
                , maxZoom: options.zoom.max
                , maxNativeZoom: options.zoom.native })]
            , attributionControl: false
            , zoomControl: false
        });
    }

    function unproject (coord) {
        return _map.unproject([coord[0], coord[1]], nativeZoom);
    }

    function distanceBetween (coord1, coord2) {
        return Math.sqrt(Math.pow(coord2.lat - coord1.lat, 2) + Math.pow(coord2.lng - coord1.lng, 2));
    }

    function recalcCoords (coord) {
        var c = zone.cont_rect, z = zone.zone_rect;
        return unproject([
            Math.round(c[0][0] + (c[1][0] - c[0][0]) * (coord[0] - z[0][0]) / (z[1][0] - z[0][0])),
            Math.round(c[0][1] + (c[1][1] - c[0][1]) * (1 - (coord[1] - z[0][1]) / (z[1][1] - z[0][1])))
        ]);
    }

    function isNewZone (newZoneId) {
        return (!zone.id || zone.id !== newZoneId)
    }

    function panToPlayer () {
        _map.panTo(playerMarker.getLatLng(), {animate: true});
    }

    function createEventMarker (event) {
        var options = {
            color: event.isGroupEvent ? '#ffc000' : '#d1632a',
            opacity: 0.8,
            fillOpacity: 0.4,
            smoothFactor: 0};
        var radius = Math.max(50000, event.radius * 10);

        switch (event.shape) {
        case "sphere":
             return L.layerGroup([
                L.circle(event.location, radius, options)]);
        case "poly":
            return L.layerGroup([
                L.polygon(event.points.map(recalcCoords), options)]);
        default:
            // debugger;
        }
    }

    function displayEvent (event) {
        clearEvents();
        markerLayers.event = createEventMarker(event)
        markerLayers.event.addTo(_map);
        _map.panTo(event.location, {animate: true});
    }

    function clearEvents () {
        // Remove previous events
        if ("event" in markerLayers)
            markerLayers.event.clearLayers();

        if ("lockedEvent" in markerLayers)
            markerLayers.lockedEvent.clearLayers();
    }

    function lockEvent (event) {
        clearEvents();
        markerLayers.lockedEvent = createEventMarker(event);
        markerLayers.lockedEvent.addTo(_map);
    }

    function fetchEvents () {
         return $.getJSON(
            EVENTS_URL.replace("{w}", server).replace("{m}", zone.id));
    }

    function loadEvents (data, textStatus, jqXHR) {
        // for (e in events)
        //      if (events.hasOwnProperty(e))
        //          delete events[e];
        while (events.length > 0)
            events.pop();

        data.events.forEach(function(evt) {
            if (evt.state !== "Active")
                return;

            $.getJSON(
                EVENT_DETAILS_URL
                    .replace("{e}", evt.event_id),
                function (details) {
                    var e = details.events[evt.event_id];
                    var newEvt = {
                        name: e.name
                        , isGroupEvent: e.flags.indexOf("group_event") !== -1
                        , level: e.level
                        , location: recalcCoords(e.location.center)
                        , distance: distanceBetween(
                            playerMarker.getLatLng(),
                            recalcCoords(e.location.center))
                        , shape: e.location.type
                    };

                    if (e.location.type === "sphere")
                        newEvt.radius = e.location.radius;
                    else if (e.location.type === "poly")
                        newEvt.points = e.location.points;

                    events.push(newEvt);
                    updateScope();
            });
        });
    }

    function loadZoneInfo (zoneId) {
        return $.getJSON(
            MAPS_URL.replace("{m}", zoneId),
            function (data) {
                zone = {
                    continent: data.maps[zoneId].continent_id
                    , cont_rect: data.maps[zoneId].continent_rect
                    , zone_rect: data.maps[zoneId].map_rect
                    , id: zoneId
                    , floor: data.maps[zoneId].default_floor
                };
            });
    }

    function loadZonePoints () {

        localInfo = localStorage.getObject('info');

        if (localInfo && zone.id in localInfo.zones) {
            info = localInfo
            setZone(zone.id);
        }
        else
            return $.getJSON(
                MAP_FLOOR_URL
                    .replace("{c}", zone.continent)
                    .replace("{f}", zone.floor),
                function (data) {
                    setRegionData(data.regions);
                    setZone(zone.id);
                }
            );
    }

    function setPlayerMarker (pos, dir, name) {
        name = typeof name !== 'undefined' ? name : '';
        pos = unproject(pos);

        if (!playerMarker) {
            playerMarker = L.marker(pos, {
                icon: L.divIcon({
                    iconSize: [48, 48],
                    iconAnchor: [24, 24],
                    className: 'markerPlayer',
                    html: '<img src="media/position.png">' })}).addTo(_map);
            playerMarker._icon.title = name;
            playerMarker.setZIndexOffset(1000);
        } else {
            playerMarker.setLatLng(pos);
            playerMarker.update();
        }

        if (!_map.getBounds().pad(-0.2).contains(pos))
            _map.setView(pos);

        if (dir !== 'undefined') {
            var scale = (_map.getZoom() + 16) / 23;

            $('.markerPlayer img').css({
                transform:
                    'scale(' + scale + ',' + scale + ') rotate(' + dir + 'deg)'
            });
        }
    }

    function setRegionData (regions) {
        var r, m;
        for (r in regions) {
            if (!(r in info.regions))
                info.regions[r] = {
                    name: regions[r].name
                    , label_coord: regions[r].label_coord
                };

            for (m in regions[r].maps)
                if (!(m in info.zones))
                    info.zones[m] = regions[r].maps[m];
        }
        localStorage.setObject('info', info);
    }

    function setServer (srv) {
        server = srv;
    }

    function setZone (zoneId) {
        var markers = {}, points, i, il, key, poi, iconUrl
            , zoneLoaded = zoneId in info.zones
            , differentFloor =
                zoneLoaded && zone.floor !== info.zones[zoneId].default_floor;

        // Load map names if they doesn't yet exist
        if (!zoneLoaded || differentFloor) {
            loadZoneInfo(zoneId).then(loadZonePoints)
            return;
        }

        for (key in markerLayers)
            if (markerLayers.hasOwnProperty(key))
                markerLayers[key].clearLayers();

        zone.id = zoneId;
        points = info.zones[zoneId].points_of_interest;

        // Load waypoints, landmarks, and vistas
        for (i = 0, il = points.length; i < il; i++) {
            poi = points[i];

            switch (poi.type) {
                case "waypoint":
                case "vista":
                    iconUrl = Resources['map_' + poi.type];
                    break;
                case "landmark":
                    iconUrl = Resources.map_poi;
                    break;
                default:
                    // alert("POI Type Doesn't Exist");
                    continue;
            }

            if (!(poi.type in markers))
                markers[poi.type] = [];

            markers[poi.type].push(L.marker(unproject(poi.coord), {
                icon: L.icon({
                    iconUrl: iconUrl,
                    iconSize: [40, 40],
                    iconAnchor: [20, 20]
                }),
                title: poi.name
            }));
        }

        for (key in markers)
            if (markers.hasOwnProperty(key)) {
                markerLayers[key] = L.layerGroup(markers[key]);
                markerLayers[key].addTo(_map);
            }

        fetchEvents().then(loadEvents);
    }

    return {
        events: events
        , initialize: initialize
        , lockEvent: lockEvent
        , isNewZone: isNewZone
        , setPlayerMarker: setPlayerMarker
        , setServer: setServer
        , setZone: setZone
        , displayEvent: displayEvent
        , clearEvents: clearEvents
        , panToPlayer: panToPlayer
    };
})();


///////////////
// Controllers
///////////////

app.controller('MapCtrl', ['$scope', function ($scope) {

    MapManager.initialize({
        zoom: { min: 3, max: 9, native: 7, default: 7 },
        center: { lat: 0, lng: 0 },
        tiles: { url: MAP_TILES_URL }});

    $scope.events = MapManager.events;
    $scope.showEventLocation = MapManager.displayEvent;

    $scope.panToPlayer = function (argument) {
        if (!MapManager.lockedEvent)
            MapManager.clearEvents();

        MapManager.panToPlayer();
    };

    $scope.lockEvent = function (event) {
        MapManager.lockEvent(event);
        $scope.$apply();
        $(".event-list")[0].style.top = (80 + $(".locked-event").height()) + "px";
    }

    $scope.initialize = function () {
        var host = "localhost",
            port = "8080",
            uri = "/ws",
            ws = new WebSocket("ws://" + host + ":" + port + uri);

        ws.onmessage = function processMessage (evt) {
            var json = angular.fromJson(evt.data);
            var setCamera = false;

            if (json.updated) {

                // On first run or new map
                if (MapManager.isNewZone(json.zone.id)) {
                    MapManager.setServer(json.server.id);
                    MapManager.setZone(json.zone.id);
                    MapManager.setPlayerMarker(
                        json.position, json.direction, json.name);
                } else if (json.updates.indexOf('position') !== -1) {
                    MapManager.setPlayerMarker(json.position, json.direction);
                }
            }
        };

        ws.onclose = function (evt) {
            console.log("Connection close");
        };

        ws.onopen = function (evt) {
            console.log("Connection open");
        };
    };
}]);
