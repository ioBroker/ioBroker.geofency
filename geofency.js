/**
 *
 * geofency adapter
 * This Adapter is based on the geofency adapter of ccu.io
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils = require('@iobroker/adapter-core'); // Get common adapter utils

var webServer =  null;
var activate_server = false;

var adapter = utils.Adapter({
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
    },
    message: function (msg) {
        processMessage(msg);
    }
});

function main() {
    checkCreateNewObjects();
    if (adapter.config.activate_server !== undefined) activate_server = adapter.config.activate_server;
        else activate_server = true;
    if (activate_server) {
        if (adapter.config.ssl) {
            // subscribe on changes of permissions
            adapter.subscribeForeignObjects('system.group.*');
            adapter.subscribeForeignObjects('system.user.*');

            if (!adapter.config.certPublic) {
                adapter.config.certPublic = 'defaultPublic';
            }
            if (!adapter.config.certPrivate) {
                adapter.config.certPrivate = 'defaultPrivate';
            }

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
    var check_user = adapter.config.user;
    var check_pass = adapter.config.pass;

    // If they pass in a basic auth credential it'll be in a header called "Authorization" (note NodeJS lowercases the names of headers in its request object)
    var auth = req.headers.authorization;  // auth is in base64(username:password)  so we need to decode the base64
    adapter.log.debug("Authorization Header is: ", auth);

    var username = '';
    var password = '';
    var request_valid = true;
    if (auth && check_user.length > 0 && check_pass.length > 0) {
        var tmp = auth.split(' ');   // Split on a space, the original auth looks like  "Basic Y2hhcmxlczoxMjM0NQ==" and we need the 2nd part
        var buf = new Buffer(tmp[1], 'base64'); // create a buffer and tell it the data coming in is base64
        var plain_auth = buf.toString();        // read it back out as a string

        adapter.log.debug("Decoded Authorization ", plain_auth);
        // At this point plain_auth = "username:password"
        var creds = plain_auth.split(':');      // split on a ':'
        username = creds[0];
        password = creds[1];
        if ((username != check_user) || (password != check_pass)) {
            adapter.log.warn("User credentials invalid");
            request_valid = false;
        }
    }
    /*else {
        adapter.log.warn("Authorization Header missing but user/pass defined");
        request_valid = false;
    }*/
    if (!request_valid) {
        res.statusCode = 403;
        res.end();
        return;
    }
    if (req.method === 'POST') {
        var body = '';

        adapter.log.debug("request path:" + req.path);

        req.on('data', function (chunk) {
            body += chunk;
        });

        req.on('end', function () {
            var user = req.url.slice(1);
            var jbody = JSON.parse(body);

            handleWebhookRequest(user, jbody);

            res.writeHead(200);
            res.write("OK");
            res.end();
        });
    }
    else {
        res.writeHead(500);
        res.write("Request error");
        res.end();
    }
}

function handleWebhookRequest(user, jbody) {
    adapter.log.info("adapter geofency received webhook from device " + user + " with values: name: " + jbody.name + ", entry: " + jbody.entry);
    var id = user + '.' + jbody.name.replace(/\s|\./g, '_');

    // create Objects if not yet available
    adapter.getObject(id, function (err, obj) {
        if (err || !obj) return createObjects(id, jbody);
        setStates(id, jbody);
        setAtHome(user, jbody);
    });
}

var lastStateNames = ["lastLeave", "lastEnter"],
    stateAtHomeCount = "atHomeCount",
    stateAtHome = "atHome";


function setStates(id, jbody) {
    adapter.setState(id + '.entry', {val: ((jbody.entry == "1") ? true : false), ack: true});

    var ts = adapter.formatDate(new Date(jbody.date), "YYYY-MM-DD hh:mm:ss");
    adapter.setState(id + '.date', {val: ts, ack: true});
    adapter.setState(id + '.' + lastStateNames[(jbody.entry == "1") ? 1 : 0], {val: ts, ack: true});
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
        if (err) return;
        atHomeCount = obj ? obj.val : 0;
        adapter.getState(stateAtHome, function (err, obj) {
            if (err) return;
            atHome = obj ? (obj.val ? JSON.parse(obj.val) : []) : [];
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
            if (atHomeCount !== atHome.length) adapter.setState(stateAtHomeCount, atHome.length, true);
        });
    });
}


function createAndSetObject(id, obj) {
    adapter.setObjectNotExists(id, obj, function (err) {
        adapter.setState(id, 0, true);
    });

}

function checkCreateNewObjects() {

    function doIt() {
        var fs = require('fs'),
            io = fs.readFileSync(__dirname + "/io-package.json"),
            objs = JSON.parse(io);

        for (var i = 0; i < objs.instanceObjects.length; i++) {
            createAndSetObject(objs.instanceObjects[i]._id, objs.instanceObjects[i]);
        }
    }

    var timer = setTimeout(doIt, 2000);
    adapter.getState(stateAtHome, function (err, obj) {
        clearTimeout(timer);
        if (!obj) {
            doIt();
        }
    });
}

function processMessage(message) {
    if (!message || !message.message.user || !message.message.data) return;

    adapter.log.info('Message received = ' + JSON.stringify(message));

    handleWebhookRequest(message.message.user, message.message.data);
}
