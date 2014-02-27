
// !function(ng) {

var MAP_TILES_URL = "https://tiles.guildwars2.com/1/1/{z}/{x}/{y}.jpg",
    MAP_FLOOR_URL = "https://api.guildwars2.com/v1/map_floor.json?continent_id=1&floor=1",
    EVENTS_URL = "https://api.guildwars2.com/v1/events.json?world_id={world}&map_id={map}",
    EVENT_DETAILS_URL = "https://api.guildwars2.com/v1/event_details.json?event_id={event_id}",
    FILES_URL = "https://api.guildwars2.com/v1/files.json",
    IMAGES_URL = "https://render.guildwars2.com/file/{signature}/{file_id}.png";

// Module definition
var app = angular.module('gw2', []);

var errorCallBack = function (arg1, arg2, arg3) {
    alert(arg1);
};

var MapManager = (function () {
//function MapManager(options, tiles) {
    var _map;
    var zone = null;
    var player;
    var playerMarker = null;
    var nativeZoom;

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
        return _map.unproject([coord[0], coord[1]], nativeZoom);;
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

    return {
        initialize: initialize
        , zone: zone
        // , loadMapPoints: loadMapPoints
        , setPlayerMarker: setPlayerMarker
        // , updateCamera: updateCamera
        // , updatePlayerMarker: updatePlayerMarker
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

    // // Watch for updates to MapManager
    // $scope.$watch('MapManager', function() {
    //     alert('hey, MapManager has changed!');
    // });

    $scope.initialize = function () {
        var host = "localhost",
            port = "8080",
            uri = "/ws",
            ws = new WebSocket("ws://" + host + ":" + port + uri);

        /*
        function firstRun (evt) {
            var player = angular.fromJson(evt.data);

            // map.setView(pos, map.getZoom());
            // loadMapPoints();
            // loadEvents(event_filter);
            // supermarker.setZIndexOffset(1000)
            updateCamera(pos, MAX_ZOOM);
            pos = unproject(json.position);
            updatePlayerMarker(pos, player.direction);

            ws.onmessage = processMessage;
        };
        */

        ws.onmessage = function processMessage (evt) {
            var json = angular.fromJson(evt.data);
            var setCamera = false;

            if (json.updated) {

                // On first run or new map
                if (!MapManager.zone || MapManager.zone !== json.zone.id) {
                    MapManager.zone = json.zone.id;
                    MapManager.setPlayerMarker(
                        json.position, json.direction, json.name);
                    // loadMapPoints();
                    // loadEvents(event_filter);
                    // supermarker.setZIndexOffset(1000)
                } else if (json.updates.indexOf('position') !== -1) {
                    MapManager.setPlayerMarker(json.position, json.direction);
                }
                /*

                if (setCamera)
                    updateCamera(pos, MAX_ZOOM);

                $scope.$apply();
                */
                //     if (!map.getBounds().pad(-0.2).contains(pos))
                //         map.setView(pos, map.getZoom());

                //     if ("_icon" in supermarker)
                //         supermarker._icon.title = player.name;

                //     supermarker.update();
                //     oldPos = pos;
                //     scale = 1 - 0.05 * (7 - map.getZoom());

                //     console.log(player.direction)
                //     $('.fancyPlayerPos img').css({
                //         transform: 'scale(' + scale + ',' + scale + ') rotate(' + json.direction + 'deg)'
                //     });
                // }
            }
        };

        // ws.onmessage = firstRun;

        ws.onclose = function (evt) {
            console.log("Connection close");
        };

        ws.onopen = function (evt) {
            console.log("Connection open");
        };
    };

    // if (!map) {
    //     initializeMap();
    // }

    // function initializeMap() {
    //     leafletData.setMap()
    //     .then(function(m) {
    //         map = m;

    //         var southWest = unproject([0, 32768]),
    //             northEast = unproject([32768, 0]);
    //         map.setView(pos, map.getZoom() | 7);
    //     })
    //     .catch(function(e) {
    //         debugger;
    //     })
    //     .finally(function(e) {
    //         debugger;
    //     });
    // }

    // function unproject(coord) {
    //     return map.unproject(coord, map.getMaxZoom());
    // }
}]);
