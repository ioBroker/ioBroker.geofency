/**
 *
 * geofency adapter
 * This Adapter is based on the geofency adapter of ccu.io
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
            callback();
        } catch (e) {
            callback();
        }
    },
    ready: function () {
        adapter.log.info("Adapter got 'Ready' Signal - initiating Main function...");
        main();
    }
});

function main() {
    chechCreateNewObjects();
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
            var user = req.url.slice(1);
            var jbody = JSON.parse(body);

            adapter.log.info("adapter geofency received webhook from device " + user + " with values: name: " + jbody.name + ", entry: " + jbody.entry);
            var id = user + '.' + jbody.name.replace(/\s|\./g, '_');

            // create Objects if not yet available
            adapter.getObject(id, function (err, obj) {
                if (err || !obj) return createObjects(id, jbody); 
                setStates(id, jbody);
                setAtHome(user, jbody);
            });

            res.writeHead(200);
            res.write("OK");
            res.end();
        });
    }
}

var lastStateNames = ["lastLeave", "lastEnter"],
    stateAtHomeCount = "atHomeCount",
    stateAtHome = "atHome";


function setStates(id, jbody) {
    adapter.setState(id + '.entry', {val: jbody.entry, ack: true});

    var ts = adapter.formatDate(new Date(jbody.date), "YYYY-MM-DD hh:mm:ss");
    adapter.setState(id + '.date', {val: ts, ack: true});
    adapter.setState(id + '.' + lastStateNames[false | jbody.entry], {val: ts, ack: true});
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
    
    for (var i = 0; i < 2; i++) {
        obj.common.name = lastStateNames[i];
        adapter.setObjectNotExists(id + "." + lastStateNames[i], obj);
        children.push(obj);
    }

    adapter.setObjectNotExists(id, {
        type: 'device',
        //children: children,
        common: {id: id, name: b.name},
        native: {name: b.name, lat: b.lat, long: b.long, radius: b.radius, device: b.device, beaconUUID: b.beaconUUID, major: b.major, minor: b.minor}
    }, function (err, obj) {
        if (!err && obj) setStates(id, b);
    });
}


function setAtHome(userName, body) {
    if (body.name.toLowerCase() !== adapter.config.atHome.toLowerCase()) return;
    var atHomeCount, atHome;
    adapter.getState(stateAtHomeCount, function (err, obj) {
        if (err || !obj) return;
        atHomeCount = obj.val;
        adapter.getState(stateAtHome, function (err, obj) {
            if (err || !obj) return;
            atHome = obj.val ? JSON.parse(obj.val) : [];
            var idx = atHome.indexOf(userName);
            if (body.entry === '1') {
                if (idx < 0) {
                    atHome.push(userName);
                    adapter.setState(stateAtHome, JSON.stringify(atHome), true);
                }
            } else {
                if (idx >= 0) {
                    atHome.splice(idx, 1);
                    adapter.setState(stateAtHome, JSON.stringify(atHome), true);
                }
            }
            if (atHomeCount != atHome.length) adapter.setState(stateAtHomeCount, atHome.length, true);
        });
    });
}


function chechCreateNewObjects() {
    adapter.getState(stateAtHome, function (err, obj) {
        if (obj) return;
        var fs = require('fs'),
            io = fs.readFileSync(__dirname + "/io-package.json"),
            objs = JSON.parse(io);
        
        for (var i = 0; i < objs.instanceObjects.length; i++) {
            adapter.setObjectNotExists(objs.instanceObjects[i]._id, objs.instanceObjects[i], function (err, obj) {
                adapter.setState(obj.id, 0, true);
            });
        }
    })
}

