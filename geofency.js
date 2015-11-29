/**
 *
 * geofency adapter
 * This Adapter is currently a copy of the ccu.io geofency adapter and adapted to ioBroker
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils
var express =   require('express'),
    io =        require('socket.io-client'),
    expressBasicAuth = require('basic-auth-connect'),
    bodyparser = require('body-parser'),
    app =       express();

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.example.0
var adapter = utils.adapter('geofency');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// todo
adapter.on('discover', function (callback) {

});

// todo
adapter.on('install', function (callback) {
    adapter.log.info("adapter geofency installed");
});

// todo
adapter.on('uninstall', function (callback) {
    adapter.log.info("adapter geofency UN-installed");
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if state is desired or acknowledged
    if (!state.ack) {
        adapter.log.info('ack is not set!');
    }
});

adapter.on('ready', function () {
    adapter.log.info("Adapter got 'Ready' Signal - initiating Main function...");
    main();
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == "object" && obj.message) {
        if (obj.command == "send") {
            // e.g. send email or pushover or whatever
            adapter.log.info("send command");

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

function main() {
    if (adapter.config.ioListenPort) {
        var socket = io("http://127.0.0.1:" + adapter.config.ioListenPort);
    } else if (adapter.config.ioListenPortSsl) {
        var socket = io("https://127.0.0.1:" + adapter.config.ioListenPortSsl);
    } else {
        var socket = io("http://127.0.0.1:" + adapter.config.port);
        //process.exit();
    }

    function stop() {
        adapter.log.info("adapter geofency terminating");
        setTimeout(function () {
            process.exit();
        }, 500);
    }

    app.use(expressBasicAuth(adapter.config.user, adapter.config.pass));

    if (adapter.config.ssl === 'checked') {
        var fs = require('fs');
        var server = require('https').createServer({
            key: fs.readFileSync(__dirname+'/cert/privatekey.pem'),
            cert: fs.readFileSync(__dirname+'/cert/certificate.pem')
        }, app);
    } else {
        var server = require('http').createServer(app);
    }

    server.listen(adapter.config.port);

    app.use(bodyparser.json({type:'*/json'}));
//app.use(bodyparser.text());
    app.post('/*', function (req, res) {
        res.set('Content-Type', 'text/html');
        var id = req.path.slice(1);

        adapter.log.info("adapter geofency received webhook from device " + id + " with values: name: " + req.body.name + ", entry: " + req.body.entry);
        id = id + '.' + req.body.name;

        // create Objects if not yet available
        createObjects(id, req.body);


        adapter.setState(id + '.entry', {val: req.body.entry, ack: true, expire: 86400});
        adapter.setState(id + '.date', {val: formatTimestamp(req.body.date), ack: true, expire: 86400});


        res.status(200);
        res.send("OK");
    });
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
}

