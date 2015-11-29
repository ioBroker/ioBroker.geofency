/**
 *
 * geofency adapter
 * This Adapter is currently a copy of the ccu.io geofency adapter and adapted to ioBroker
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

    var utils = require(__dirname + '/lib/utils'); // Get common adapter utils

    var webServer =  null;

    var adapter = utils.adapter({
        name: 'geofency',

        unload: function (callback) {
            try {
                adapter.log.info("terminating http" + (webServer.settings.secure ? "s" : "") + " server on port " + webServer.settings.port);
                //if (webServer.api) webServer.api.close();
                callback();
            } catch (e) {
                callback();
            }
        },
        discover: function (callback) {

        },
        install: function (callback) {
            adapter.log.info("adapter geofency installed");
        },
        uninstall: function (callback) {
            adapter.log.info("adapter geofency UN-installed");
        },
        objectChange: function (id, obj) {
            adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
            if (webServer && webServer.api) {
                webServer.api.objectChange(id, obj);
            }
        },
        stateChange: function (id, state) {
            adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
            if (webServer && webServer.api) {
                webServer.api.stateChange(id, state);
            }
        },
        ready: function () {
            adapter.log.info("Adapter got 'Ready' Signal - initiating Main function...");
            main();
        },
        message: function (obj) {
            if (typeof obj == "object" && obj.message) {
                if (obj.command == "send") {
                    // e.g. send email or pushover or whatever
                    adapter.log.info("send command");

                    // Send response in callback if required
                    if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
                }
            }
        }
    });

function main() {
    if (adapter.config.ssl) {
        // subscribe on changes of permissions
        adapter.subscribeForeignObjects('system.group.*');
        adapter.subscribeForeignObjects('system.user.*');

        // Load certificates
        adapter.getForeignObject('system.certificates', function (err, obj) {
            if (err || !obj || !obj.native.certificates || !adapter.config.certPublic || !adapter.config.certPrivate || !obj.native.certificates[adapter.config.certPublic] || !obj.native.certificates[adapter.config.certPrivate]
            ) {
                adapter.log.error('Cannot enable secure web server, because no certificates found: ' + adapter.config.certPublic + ', ' + adapter.config.certPrivate);
            } else {
                adapter.config.certificates = {
                    key: obj.native.certificates[adapter.config.certPrivate],
                    cert: obj.native.certificates[adapter.config.certPublic]
                };

            }
            webServer = initWebServer(adapter.config);
        });
    } else {
        webServer = initWebServer(adapter.config);
    }
}

//default settings: {
//    "port":   8080,
//    "auth":   false,
//    "secure": false,
//    "bind":   "0.0.0.0", // "::"
//    "cache":  false
//}
function initWebServer(settings) {

    var server = {
        server:    null,
        settings:  settings
    };

    if (settings.port) {
        if (settings.ssl) {
            if (!adapter.config.certificates) {
                return null;
            }
        }

        if (settings.ssl) {
            server.server = require('https').createServer(adapter.config.certificates, requestProcessor);
        } else {
            server.server = require('http').createServer(requestProcessor);
        }

        server.server.__server = server;
    } else {
        adapter.log.error('port missing');
        process.exit(1);
    }

    if (server.server) {
        adapter.getPort(settings.port, function (port) {
            if (port != settings.port && !adapter.config.findNextPort) {
                adapter.log.error('port ' + settings.port + ' already in use');
                process.exit(1);
            }
            server.server.listen(port);
            adapter.log.info('http' + (settings.ssl ? 's' : '') + ' server listening on port ' + port);
        });
    }

    if (server.server) {
        return server;
    } else {
        return null;
    }
}

function requestProcessor(req, res) {
    if (req.method === 'POST') {
        var body = '';

        adapter.log.debug("request path:" + req.path);

        req.on('data', function (chunk) {
            body += chunk;
        });

        req.on('end', function () {
            var id = req.path.slice(1);
            var jbody = JSON.parse(body);

            adapter.log.info("adapter geofency received webhook from device " + id + " with values: name: " + jbody.name + ", entry: " + jbody.entry);
            id = id + '.' + jbody.name;

            // create Objects if not yet available
            createObjects(id, jbody);

            adapter.setState(id + '.entry', {val: jbody.entry, ack: true, expire: 86400});
            adapter.setState(id + '.date', {val: formatTimestamp(jbody.date), ack: true, expire: 86400});

            res.writeHead(200);
            res.write("OK");
            res.end();
        });
    }
}
function createObjects(id, b) {
    // create all Objects
    var children = [];

    var obj = {
        type: 'state',
        //parent: id,
        common: {name: 'entry', read: true, write: true, type: 'boolean'},
        native: {id: id}
    };
    adapter.setObjectNotExists(id + ".entry", obj);
    children.push(obj);
    obj = {
        type: 'state',
        //parent: id,
        common: {name: 'date', read: true, write: true, type: 'string'},
        native: {id: id}
    };
    adapter.setObjectNotExists(id + ".date", obj);
    children.push(obj);

    adapter.setObjectNotExists(id, {
        type: 'device',
        //children: children,
        common: {id: id, name: b.name},
        native: {name: b.name, lat: b.lat, long: b.long, radius: b.radius, device: b.device, beaconUUID: b.beaconUUID, major: b.major, minor: b.minor}
    });
};

function formatTimestamp(str) {
    var timestamp = new Date(str);
    var ts = timestamp.getFullYear() + '-' +
        ("0" + (timestamp.getMonth() + 1).toString(10)).slice(-2) + '-' +
        ("0" + (timestamp.getDate()).toString(10)).slice(-2) + ' ' +
        ("0" + (timestamp.getHours()).toString(10)).slice(-2) + ':' +
        ("0" + (timestamp.getMinutes()).toString(10)).slice(-2) + ':' +
        ("0" + (timestamp.getSeconds()).toString(10)).slice(-2);
    return ts;
};

