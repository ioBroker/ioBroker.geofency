/**
 *
 * geofency adapter
 * This Adapter is based on the geofency adapter of ccu.io
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

const utils = require('@iobroker/adapter-core'); // Get common adapter utils

let webServer =  null;
let activate_server = false;
const objectsInitialized = {};

let adapter = utils.Adapter({
    name: 'geofency',

    unload: function (callback) {
        try {
            webServer.close(() => {
                adapter && adapter.log && adapter.log.info(`http${webServer.settings.secure ? "s" : ""} server terminated on port ${webServer.settings.port}`);
                callback();
            });
        } catch (e) {
            callback();
        }
    },
    ready: function () {
        main();
    },
    message: function (msg) {
        processMessage(msg);
    }
});

function main() {
    adapter.setState('info.connection', false, true);
    activate_server = adapter.config.activate_server !== undefined ? adapter.config.activate_server: true;

    if (activate_server) {
        adapter.config.port = parseInt(adapter.config.port, 10);
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
                    // if pub cert not starts with '----' expect it's a path to the certificate and try to load the cert content
                    var pub_cert = String(obj.native.certificates[adapter.config.certPublic]);
                    if (! pub_cert.startsWith('----')) {
                        var fs = require('fs');
                        var contents = fs.readFileSync(pub_cert, 'utf8', (err));
                        if ( ! err) {
                            adapter.log.info(`Read public certificate from file \'${pub_cert}\'.`);
                            pub_cert = contents;
                        }
                    }

                    // if pub cert not starts with '----' expect it's a path to the certificate and try to load the cert content
                    var priv_cert = String(obj.native.certificates[adapter.config.certPrivate]);
                    if (! priv_cert.startsWith('----')) {
                        var fs = require('fs');
                        var contents = fs.readFileSync(priv_cert, 'utf8', (err));
                        if ( ! err) {
                            adapter.log.info(`Read private certificate from file \'${priv_cert}\'.`);
                            priv_cert = contents;
                        }
                    }

                    adapter.config.certificates = {
                        key: priv_cert,
                        cert: pub_cert
                    };
                }
                webServer = initWebServer(adapter.config);
            });
        } else {
            webServer = initWebServer(adapter.config);
        }
    } else {
        adapter.setState('info.connection', true, true);
    }
}

function initWebServer(settings) {

    const server = {
        server:    null,
        settings:  settings
    };

    if (settings.port) {
        if (settings.ssl) {
            if (!adapter.config.certificates) {
                adapter.log.error(`Cannot start http${settings.ssl ? 's' : ''} server: SSL required but no certificates selected!`)
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
        adapter.log.error(`Cannot start http${settings.ssl ? 's' : ''} server: No port provided!`);
        return;
    }

    if (server.server) {
        adapter.getPort(settings.port, function (port) {
            if (port !== settings.port && !adapter.config.findNextPort) {
                adapter.log.error(`Cannot start http${settings.ssl ? 's' : ''} server: Port ${settings.port} already in use!`);
                return;
            }
            try {
                server.server.listen(port);
            } catch (err) {
                adapter.log.warn(`Cannot start http${settings.ssl ? 's' : ''} server: ${err.message}`);
                return;
            }
            adapter.setState('info.connection', true, true);
            adapter.log.info(`http${settings.ssl ? 's' : ''} server listening on port ${port}`);
        });
    }

    if (server.server) {
        return server;
    } else {
        return null;
    }
}

function requestProcessor(req, res) {
    const check_user = adapter.config.user;
    const check_pass = adapter.config.pass;

    // If they pass in a basic auth credential it'll be in a header called "Authorization" (note NodeJS lowercases the names of headers in its request object)
    const auth = req.headers.authorization;  // auth is in base64(username:password)  so we need to decode the base64
    adapter.log.debug(`Authorization Header is: ${JSON.stringify(auth)}`);

    let username = '';
    let password = '';
    let request_valid = true;
    if (auth && check_user.length > 0 && check_pass.length > 0) {
        const tmp = auth.split(' ');   // Split on a space, the original auth looks like  "Basic Y2hhcmxlczoxMjM0NQ==" and we need the 2nd part
        const buf = new Buffer(tmp[1], 'base64'); // create a buffer and tell it the data coming in is base64
        const plain_auth = buf.toString();        // read it back out as a string

        adapter.log.debug(`Decoded Authorization ${plain_auth}`);
        // At this point plain_auth = "username:password"
        const creds = plain_auth.split(':');      // split on a ':'
        username = creds[0];
        password = creds[1];
        if ((username !== check_user) || (password !== check_pass)) {
            adapter.log.warn('User credentials invalid');
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
        let body = '';

        adapter.log.debug(`request path:${req.path}`);

        req.on('data', (chunk) => {
            body += chunk;
        });

        req.on('end', async () => {
            const user = req.url.slice(1);
            try {
                const jbody = JSON.parse(body);
                await handleWebhookRequest(user, jbody);
            } catch (err) {
                adapter.log.info(`Could not process request for user ${user}: ${err}`);
                res.writeHead(500);
                res.write('Request error');
                res.end();
                return;
            }

            res.writeHead(200);
            res.write('OK');
            res.end();
        });
    }
    else {
        res.writeHead(500);
        res.write('Request error');
        res.end();
    }
}

async function handleWebhookRequest(user, jbody) {
    adapter.log.info(`adapter geofency received webhook from device ${user} with values: name: ${jbody.name}, entry: ${jbody.entry}`);
    const id = user.replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_') + '.' + jbody.name.replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_');

    if (!objectsInitialized[id]) {
        await createObjects(id, jbody);
        objectsInitialized[id] = true;
    }
    setStates(id, jbody);
    setAtHome(user, jbody);
}

const lastStateNames = ['lastLeave', 'lastEnter'],
      stateAtHomeCount = 'atHomeCount',
      stateAtHome = 'atHome';

function setStates(id, jbody) {
    adapter.setState(id + '.entry', {val: (jbody.entry == '1'), ack: true});

    const ts = adapter.formatDate(new Date(jbody.date), 'YYYY-MM-DD hh:mm:ss');
    adapter.setState(`${id}.date`, {val: ts, ack: true});
    adapter.setState(`${id}.${lastStateNames[(jbody.entry == '1') ? 1 : 0]}`, {val: ts, ack: true});
    adapter.setState(`${id}.motion`, {val: jbody.motion, ack: true});
    adapter.setState(`${id}.name`, {val: jbody.name, ack: true});
    adapter.setState(`${id}.currentLatitude`, {val: jbody.latitude, ack: true});
    adapter.setState(`${id}.currentLongitude`, {val: jbody.longitude, ack: true});

    adapter.setState(`${id}.json`, JSON.stringify(jbody), true);

    for (const entry of Object.keys(jbody)) {
        if (!objectsInitialized[`${id}.data.${entry}`]) continue;
        adapter.setState(`${id}.data.${entry}`, jbody[entry], true);
    }
}


async function createObjects(id, body) {
    // create all Objects
    await adapter.extendObjectAsync(id, {
        type: 'device',
        common: {name: body.name},
        native: {name: body.name, lat: body.lat, long: body.long, radius: body.radius, device: body.device, beaconUUID: body.beaconUUID, major: body.major, minor: body.minor}
    });

    let obj = {
        type: 'state',
        common: {name: 'entry', read: true, write: false, type: 'boolean'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".entry", obj);
    obj = {
        type: 'state',
        common: {name: 'date', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".date", obj);
    obj = {
        type: 'state',
        common: {name: 'motion', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".motion", obj);
    obj = {
        type: 'state',
        common: {name: 'name', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".name", obj);
    obj = {
        type: 'state',
        common: {name: 'currentLatitude', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".currentLatitude", obj);
    obj = {
        type: 'state',
        common: {name: 'currentLongitude', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".currentLongitude", obj);
    obj = {
        type: 'state',
        common: {name: 'lastLeave', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".lastLeave", obj);
    obj = {
        type: 'state',
        common: {name: 'lastEnter', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".lastEnter", obj);

    obj = {
        type: 'state',
        common: {name: 'json', read: true, write: false, role: 'json', type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(id + ".json", obj);

    await adapter.extendObjectAsync(id + '.data', {
        type: 'channel',
        common: {name: body.name + ' Data'},
        native: {id}
    });

    for (const entry of Object.keys(body)) {
        let type = body[entry] !== null ? typeof body[entry] : 'mixed';
        if (type === 'object') {
            type = 'string';
        }
        obj = {
            type: 'state',
            common: {name: entry, read: true, write: false, type},
            native: {id}
        };
        await adapter.extendObjectAsync(`${id}.data.${entry}`, obj);
        objectsInitialized[`${id}.data.${entry}`] = true;
    }
}


function setAtHome(userName, body) {
    if (body.name.toLowerCase() !== adapter.config.atHome.toLowerCase()) return;
    let atHomeCount, atHome;
    adapter.getState(stateAtHomeCount, function (err, obj) {
        if (err) return;
        atHomeCount = obj ? obj.val : 0;
        adapter.getState(stateAtHome, function (err, obj) {
            if (err) return;
            atHome = obj ? (obj.val ? JSON.parse(obj.val) : []) : [];
            const idx = atHome.indexOf(userName);
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

async function processMessage(message) {
    if (!message || !message.message.user || !message.message.data) return;

    adapter.log.info('Message received = ' + JSON.stringify(message));

    try {
        await handleWebhookRequest(message.message.user, message.message.data);
    } catch (err) {
        adapter.log.info(`Could not process request for user ${message.message.user}: ${err}`);
    }
}

