# ioBroker.geofency
This Adapter is able to receive [geofency](http://www.geofency.com/) events when entering or leaving a defined area with your mobile device.
All values of the geofency-webhook of the request are stored under the name of the location in ioBroker.

##configuration on mobile device:
* for any location -> properties -> webhook settings:
 * URL for entry & exit: &lt;your ioBroker Domain&gt;:&lt;configured port&gt;/&lt;any locationname&gt;
 * Post Format: JSON-encoded: enabled
 * authentication: set user / password from iobroker.geofency config

##in ioBroker Forum (German)
http://forum.iobroker.org/viewtopic.php?f=20&t=2076&sid=0e4d0505719b9d4f36e69e9009fafee3

##security note:
It is not recommended to expose this adapter to the public internet.
Some kind of WAF/proxy/entry Server should be put before ioBroker. (e.g. nginx is nice and easy to configure).

#changelog

## 0.0.1
initial release


# Todo
TODO


# License

The MIT License (MIT)

Copyright (c) 2015 dschaedl <daniel.schaedler@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.