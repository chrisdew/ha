#!/usr/bin/env node
// This is a trivial HA implementation in NodeJS
// This script should be installed on all the boxes which host the virtual address.
// Generally it will not be necessary to alter any parameters on a per-box basis.

// config
var STANDBY = 'STANDBY', ACTIVE = 'ACTIVE', SHUTDOWN = 'SHUTDOWN';
var MULTICAST_INTERVAL = 1000; // ms
var TOLERANCE = 3500; // ms of missed packets before becoming master
var CHILD_TIMEOUT = 10000; // ms before the program exits due to a child command
                           // not completing
var ETHERNET_DEVICE = 'eth0';
var SHARED_ETHERNET_DEVICE = 'eth0:0';
var IP_VERSION = 'IPv4';
var MULTICAST_ADDRESS = '239.1.2.3'; // a unique combination of MULTICAST_ADDRESS
var MULTICAST_PORT = 5554;           // and MULTICAST_PORT defines the group
//var MULTICAST_INTERFACE = undefined; // default

// imports
var spawn = require('child_process').spawn
var dgram = require('dgram');
var os = require('os');
var fs = require('fs');

// override config from /etc/ha.json
// TODO: now I've realised that it needs a config file, this should be done a lot more neatly
try {
  var content = fs.readFileSync('/etc/ha.json','utf8'); 
  var c = JSON.parse(content);
  if (c.ethernetDevice) ETHERNET_DEVICE = c.ethernetDevice;
  if (c.sharedEthernetDevice) SHARED_ETHERNET_DEVICE = c.sharedEthernetDevice;
  console.info('read config from /etc/ha.json');
} catch (e) {
  console.warn('unable to read /etc/ha.json');
}

// run main if this file has running stand-alone
if (!module.parent) { main(); } 

/*
 * This sets up the program and returns immediately. 
 * All this code could just be at the 'top level', but I prefer to isolate the running
 * state of the program ('state' and 'timeout') from functions which do not need it.
 * i.e. spawn2 and findAddress
 * This also allows ha.js to be required from another modules without automatically invoking
 * running main().
 */
function main() {
  // STANDBY/ACTIVE state
  var state, timeout;
  change_state(STANDBY);

  var address = findAddress(ETHERNET_DEVICE, IP_VERSION);
  if (!address) { console.error('IP address not found'); process.exit(1); }
  var msg = new Buffer('https://github.com/chrisdew/ha'); // No data, the multicast's src ip is the data.
                                                          // Broadcasting the URL, in case
                                                          // anyone wonders what the traffic is.

  // bind the multicast socket
  var socket = dgram.createSocket('udp4');
    socket.bind(MULTICAST_PORT, MULTICAST_ADDRESS, function() {
    socket.setMulticastTTL(64);
    socket.setMulticastLoopback(false);
    socket.addMembership(MULTICAST_ADDRESS);
    socket.on('message', function(data, rinfo) {
      //console.log(data, rinfo);
      // in this trivial implementation, the lowest IP address (by alpha-numeric sort) will
      // claim the right to be ACTIVE
      if (rinfo.address < address) change_state(STANDBY);
    });
    setInterval(function() {
      // multicast every MULTICAST_INTERVAL to suppress any less worthy node from going
      // active
      socket.send(msg, 0, msg.length, MULTICAST_PORT, MULTICAST_ADDRESS);
    }, MULTICAST_INTERVAL);
  });

  var sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (var i in sigs) {
    (function(sig) { // work around until we get 'let'
      process.on(sig, function() {
        var ms = TOLERANCE / 2;
        console.log('Shutting down due to', sig, ', in', ms + 'ms...');
        change_state(SHUTDOWN);
        setTimeout(function() {
          console.log("Exiting now, press ENTER for command prompt.");
          process.exit(0);
        }, ms);
      });
    })(sigs[i]); // work around until we get 'let'
  }

  /*
   * This function invokes the side-effects which need to happen on a state change.
   * These are:
   * 1. bring up/down the shared interface
   * 2. (ACTIVE only) gratuitously arp the shared interface by both methods
   * 
   * This function is defined *inside* main as it needs access to set the 'state' variable.
   */
  function change_state(new_state) {
    if (new_state !== state) {
      console.info('switching from', state, 'to', new_state);
    }
    if (state === SHUTDOWN) return;  // never change out of shutdown
    if (new_state === STANDBY) {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(function() { change_state(ACTIVE); }, TOLERANCE);
    }
    if (state === ACTIVE && (new_state === STANDBY || new_state === SHUTDOWN)) {
      spawn2("ifdown", [SHARED_ETHERNET_DEVICE]);
    }
    if (state === STANDBY && new_state === ACTIVE) {
      console.log('zzzz', findAddress(SHARED_ETHERNET_DEVICE, IP_VERSION));
      spawn2("ifup", [SHARED_ETHERNET_DEVICE], function(err) {
        if (!err) { // only do gratuitous arp is interface has come up without error
          var shared_addr = findAddress(SHARED_ETHERNET_DEVICE, IP_VERSION);
          if (!shared_addr) { console.error('shared IP address not found'); process.exit(1); }
          console.info("arping", ['-A', '-I', ETHERNET_DEVICE, shared_addr, '-w', 1]);
          spawn2("arping", ['-A', '-I', ETHERNET_DEVICE, shared_addr, '-w', 1]);
          console.info("arping", ['-U', '-I', ETHERNET_DEVICE, shared_addr, '-w', 1]);
          spawn2("arping", ['-U', '-I', ETHERNET_DEVICE, shared_addr, '-w', 1]);
        }
      });
    }
    state = new_state;
  }
}

/*
 * This function augments the spawn function with:
 * 1. extra logging
 * 2. a timeout to kill the whole process, if a child does not return
 * 3. an optional callback to be executed on completion
 */
function spawn2(command, args, callback /*optional*/) {
  console.info('spawning', command, args, callback ? 'with callback' : 'no callback');
  var child_start = new Date().getTime();
  var child = spawn(command, args);
  var child_timeout = setTimeout( function() {
    console.warn("child process has not exited: ", command, args);
    process.exit(2);
  }, CHILD_TIMEOUT);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', function(data) { console.log('stdout:', data); });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', function(data) { console.log('stderr:', data); });
  child.on('exit', function(code) {
    console.log('exit code:', code, 'elapsed time (ms):', new Date().getTime() - child_start);
    clearTimeout(child_timeout);
    if (!callback) return;
    return callback(!!code ? code : undefined); // only call with err if code != 0
  });
}


/*
 * This finds the *first* (generally the only) address for a particular 
 * ethernet_device/ip_version combination.
 */
function findAddress(ethernet_device, ip_version) {
  // find the ethernet address
  var addresses = os.networkInterfaces()[ethernet_device];
  var address = undefined;
  for (var i in addresses) {
    if (addresses[i].family === ip_version) {
      address = '' + addresses[i].address;
      break;
    }
  }
  return address;
}

// possible improvements:
// 1. create a per-node 'worthiness' parameter, which is used instead of the ip address
//    for determining worthiness
// 2. - or - sort ip addresses numerically
// 3. speedup the garping by not making it wait for the completion of 'if up'
// 4. work around requiring the script to be run as root
