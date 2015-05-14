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

### adapter(uri[, opts])

`uri` is a string like `amqp://localhost` which points to your AMQP / RabbitMQ server.
The amqp:// scheme is MANDATORY. If you need to use a username & password, they must
be embedded in the URI.

The following options are allowed:

- `prefix`: A prefix that will be applied to all queues, exchanges and messages created by socket.io-amqp.


This is a direct port of socket.io-redis except with all code modified for use with amqplib.

