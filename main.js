/**
 *
 * geofency adapter
 * This Adapter is based on the geofency adapter of ccu.io
 *
 */

/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';

const utils       = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();

let webServer =  null;
let activateServer = false;
let adapter;
const objectsInitialized = {};

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: adapterName,
        unload: callback => {
            try {
                webServer.close(() => {
                    adapter && adapter.log && adapter.log.info(`http${webServer.settings.secure ? 's' : ''} server terminated on port ${webServer.settings.port}`);
                    callback();
                });
            } catch (e) {
                callback();
            }
        },
        ready: () => main(),
        message: msg => processMessage(msg),
    });
    adapter = new utils.Adapter(options);

    return adapter;
}

function main() {
    adapter.setState('info.connection', false, true);
    activateServer = adapter.config.activate_server !== undefined ? adapter.config.activate_server: true;

    if (activateServer) {
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
            adapter.getCertificates((error, certificates, leConfig) => {
                adapter.config.certificates = certificates;
                adapter.config.leConfig     = leConfig;
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

        try {
            if (settings.ssl) {
                server.server = require('https').createServer(adapter.config.certificates, requestProcessor);
            } else {
                server.server = require('http').createServer(requestProcessor);
            }
        } catch (err) {
            adapter.log.error(`Cannot create web-server: ${err}`);
            adapter.terminate ? adapter.terminate(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION) : process.exit(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }
        if (!server.server) {
            adapter.log.error(`Cannot create web-server`);
            adapter.terminate ? adapter.terminate(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION) : process.exit(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }


        server.server.__server = server;
    } else {
        adapter.log.error(`Cannot start http${settings.ssl ? 's' : ''} server: No port provided!`);
        return;
    }

    if (server.server) {
        adapter.getPort(settings.port, (!settings.bind || settings.bind === '0.0.0.0') ? undefined : settings.bind || undefined, port => {
            if (port !== settings.port && !adapter.config.findNextPort) {
                adapter.log.error(`Cannot start http${settings.ssl ? 's' : ''} server: Port ${settings.port} already in use!`);
                return;
            }
            try {
                server.server.listen(port, (!settings.bind || settings.bind === '0.0.0.0') ? undefined : settings.bind || undefined, () =>
                    adapter.setState('info.connection', true, true));
            } catch (err) {
                adapter.log.warn(`Cannot start http${settings.ssl ? 's' : ''} server: ${err.message}`);
                return;
            }
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
    const checkUser = adapter.config.user;
    const checkPass = adapter.config.pass;

    // If they pass in a basic auth credential it'll be in a header called "Authorization" (note NodeJS lowercases the names of headers in its request object)
    const auth = req.headers.authorization;  // auth is in base64(username:password)  so we need to decode the base64
    adapter.log.debug(`Authorization Header is: ${JSON.stringify(auth)}`);

    let requestValid = true;
    if (checkUser && checkPass) {
        if (!auth) {
            adapter.log.warn('Authorization Header missing but user/pass defined');
            requestValid = false;
        } else {
            const tmp = auth.split(' ');   // Split on a space, the original auth looks like  "Basic Y2hhcmxlczoxMjM0NQ==" and we need the 2nd part
            const plainAuth = Buffer.from(tmp[1], 'base64').toString(); // create a buffer and tell it the data coming in is base64

            adapter.log.debug(`Decoded Authorization ${plainAuth}`);
            // At this point plainAuth = "username:password"
            const [username, password] = plainAuth.split(':');      // split on a ':'
            if (username !== checkUser || password !== checkPass) {
                adapter.log.warn('User credentials invalid');
                requestValid = false;
            }
        }
    }

    if (!requestValid) {
        res.statusCode = 401;
        res.end();
        return;
    }
    if (req.method === 'POST') {
        let body = '';

        adapter.log.debug(`request url: ${req.url}`);

        req.on('data', chunk => body += chunk);

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
    await setStates(id, jbody);
    await setAtHome(user, jbody);
}

const lastStateNames = ['lastLeave', 'lastEnter'];
const stateAtHomeCount = 'atHomeCount';
const stateAtHome = 'atHome';

async function setStates(id, jBody) {
    let entry = jBody.entry;
    if (entry !== undefined) {
        entry = !!parseInt(entry, 10);
    }
    adapter.setState(id + '.entry', {val: entry, ack: true});

    const ts = adapter.formatDate(new Date(jBody.date), 'YYYY-MM-DD hh:mm:ss');
    await adapter.setStateAsync(`${id}.date`, {val: ts, ack: true});
    await adapter.setStateAsync(`${id}.${lastStateNames[entry ? 1 : 0]}`, {val: ts, ack: true});
    await adapter.setStateAsync(`${id}.motion`, {val: jBody.motion, ack: true});
    await adapter.setStateAsync(`${id}.name`, {val: jBody.name, ack: true});
    await adapter.setStateAsync(`${id}.currentLatitude`, {val: jBody.latitude, ack: true});
    await adapter.setStateAsync(`${id}.currentLongitude`, {val: jBody.longitude, ack: true});

    await adapter.setStateAsync(`${id}.json`, JSON.stringify(jBody), true);

    for (const entry of Object.keys(jBody)) {
        if (!objectsInitialized[`${id}.data.${entry}`]) {
            continue;
        }
        await adapter.setStateAsync(`${id}.data.${entry}`, jBody[entry], true);
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
    await adapter.extendObjectAsync(`${id}.entry`, obj);
    obj = {
        type: 'state',
        common: {name: 'date', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.date`, obj);
    obj = {
        type: 'state',
        common: {name: 'motion', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.motion`, obj);
    obj = {
        type: 'state',
        common: {name: 'name', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.name`, obj);
    obj = {
        type: 'state',
        common: {name: 'currentLatitude', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.currentLatitude`, obj);
    obj = {
        type: 'state',
        common: {name: 'currentLongitude', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.currentLongitude`, obj);
    obj = {
        type: 'state',
        common: {name: 'lastLeave', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.lastLeave`, obj);
    obj = {
        type: 'state',
        common: {name: 'lastEnter', read: true, write: false, type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.lastEnter`, obj);

    obj = {
        type: 'state',
        common: {name: 'json', read: true, write: false, role: 'json', type: 'string'},
        native: {id}
    };
    await adapter.extendObjectAsync(`${id}.json`, obj);

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

async function setAtHome(userName, body) {
    if (body.name.toLowerCase().trim() !== adapter.config.atHome.toLowerCase().trim()) {
        return;
    }
    let atHomeCount;
    let atHome;

    const _stateAtHomeCount = await adapter.getStateAsync(stateAtHomeCount);
    atHomeCount = _stateAtHomeCount ? _stateAtHomeCount.val : 0;

    const _stateAtHome = await adapter.getStateAsync(stateAtHome);
    atHome = _stateAtHome ? (_stateAtHome.val ? JSON.parse(_stateAtHome.val) : []) : [];

    let entry = body.entry;
    if (entry !== undefined) {
        entry = !!parseInt(entry, 10);
    }

    if (entry) {
        if (!atHome.includes(userName)) {
            atHome.push(userName);
            await adapter.setStateAsync(stateAtHome, JSON.stringify(atHome), true);
        }
    } else {
        const idx = atHome.indexOf(userName);
        if (idx !== -1) {
            atHome.splice(idx, 1);
            await adapter.setStateAsync(stateAtHome, JSON.stringify(atHome), true);
        }
    }
    if (atHomeCount !== atHome.length) {
        await adapter.setStateAsync(stateAtHomeCount, atHome.length, true);
    }
}

async function processMessage(message) {
    if (!message || !message.message.user || !message.message.data) {
        return;
    }

    adapter.log.info(`Message received = ${JSON.stringify(message)}`);

    try {
        await handleWebhookRequest(message.message.user, message.message.data);
    } catch (err) {
        adapter.log.info(`Could not process request for user ${message.message.user}: ${err}`);
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
