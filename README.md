ha - High Availability using NodeJS
-----------------------------------

'ha' is a very limited high-availability application focused on one use-case:

Two or more Linux servers on one LAN, providing one shared (or virtual) IP address.


How it Works
------------

Each server is configured with a real ethernet address (e.g. eth0 192.168.1.20) and 
the shared address (e.g. eth0:1 192.168.1.100).  (I've used a virtual ethernet 
device, but this could easily be a realy device on a multi-homed server.  There is 
no requirement that the shared address is in the same subnet as the unique 
addresses.)

All the servers have unique real addresses (.20, .21, etc.), but all use the same 
virtual address (.100).  The inteface with the virtual address *must* be configured
as 'down' at boot time.

All of the servers multicast a packet each second.  Each server receives these 
packets and if it hears one from a 'more worthy' server, and is ACTIVE, it becomes 
STANDBY.

If a server doesn't hear from a more 'worthy' server in 3.5 seconds, it becomes 
ACTIVE.

All servers start in the STANDBY state.

When a server goes from STANDBY to ACTIVE it brings up the interface with the shared
address and uses gratuitous arp to tell the LAN about it as quickly as possible.


Shortcomings
------------

When a more 'worthy' node starts multicasting, the less worthy node which is 
currently hosting the shared address brings it down immediately.  The more worthy
node takes 3.5 seconds before it comes up.  This could be fixed with a more complex 
protocol and state machines.

This can be partially alleviated in by shortening the multicast interval and 
tolerance.

This HA solution is not bi- or multi-stable.  The most 'worthy' node will host the
shared address at all times.


Example /etc/network/interfaces file (Debian/Ubuntu)
----------------------------------------------------

```
# This file describes the network interfaces available on your system
# and how to activate them. For more information, see interfaces(5).

# The loopback network interface
auto lo
iface lo inet loopback

# The primary network interface
auto eth0
iface eth0 inet static
 address 192.168.1.20
 netmask 255.255.255.0
 network 192.168.1.0
 broadcast 192.168.1.255
 gateway 192.168.1.254

# The shared cluster address
auto eth0:1
iface eth0 inet static
 address 192.168.1.100
 netmask 255.255.255.0
 network 192.168.1.0
 broadcast 192.168.1.255
```


Why NodeJS, not the mature Linux HA?
------------------------------------

Because Linux HA was NIH ;)

Using NodeJS makes is extremely easy for us to add HA to our existing NodeJS 
services and lets us customise HA policy very easily.


