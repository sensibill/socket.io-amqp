# socket.io-amqp

A Socket.IO Adapter for use with RabbitMQ and other AMQP services.

[![NPM version](https://badge.fury.io/js/socket.io-amqp.svg)](http://badge.fury.io/js/socket.io-amqp)

## How to use

```js
var io = require('socket.io')(3000);
var amqp_adapter = require('socket.io-amqp');
io.adapter(amqp_adapter('amqp://localhost'));
```
## API

### adapter(uri[, opts], [onNamespaceInitializedCallback])

`uri` is a string like `amqp://localhost` which points to your AMQP / RabbitMQ server.
The amqp:// scheme is MANDATORY. If you need to use a username & password, they must
be embedded in the URI.

The following options are allowed:

- `prefix`: A prefix that will be applied to all queues, exchanges and messages created by socket.io-amqp.

- `onNamespaceInitializedCallback`: This is a callback function that is called everytime sockets.io opens a new namespace. Because a new namespace requires new queues and exchanges, you can get a callback to indicate the success or failure here. This callback should be in the form of function(err, nsp), where err is the error, and nsp is the namespace. If your code needs to wait until sockets.io is fully set up and ready to go, you can use this.


This is a direct port of socket.io-redis except with all code modified for use with amqplib.

