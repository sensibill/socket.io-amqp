/*
 This file is part of socket.io-amqp.

 socket.io-amqp is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 socket.io-amqp is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with socket.io-amqp.  If not, see <http://www.gnu.org/licenses/>.

 Please see https://github.com/genixpro/socket.io-amqp for
 more information on this project.
 */

/**
 * Module dependencies.
 */


var Adapter = require('socket.io-adapter');
var amqplib = require('amqplib/callback_api');
var async = require('async');
var when = require('when');
var msgpack = require('msgpack-js');
var debug = require('debug')('socket.io-amqp');
var underscore = require('underscore');

/**
 * Module exports.
 */

module.exports = adapter;


/**
 * Returns an AMQP adapter class
 *
 * @param {String} uri AMQP uri
 * @param {String} opts  Options for the connection.
 * @param {function} onNamespaceInitializedCallback This is a callback function that is called everytime sockets.io opens a
 *                                     new namespace. Because a new namespace requires new queues and exchanges,
 *                                     you can get a callback to indicate the success or failure here. This
 *                                     callback should be in the form of function(err, nsp), where err is
 *                                     the error, and nsp is the namespace. If your code needs to wait until
 *                                     sockets.io is fully set up and ready to go, you can use this.

 *
 * Following options are accepted:
 *      - prefix: A prefix for all exchanges,queues, and topics created by the module on RabbitMQ.
 *
 *
 *
 * @api public
 */

function adapter (uri, opts, onNamespaceInitializedCallback)
{
    opts = opts || {};

    underscore.defaults(opts, {
        queueName: '',
        channelSeperator: '#',
        prefix: ''
    });

    var prefix = opts.prefix;

    /**
     * Adapter constructor.
     *
     * @param {String} nsp name
     * @api public
     */

    function AMQPAdapter (nsp)
    {
        Adapter.call(this, nsp);

        var amqpConnectionOptions = {
            //heartbeat: 30
        };

        var self = this;

        self.connected = when.promise(function (resolve, reject)
        {
            // Connect to the AMQP Broker and set up our exchanges and queues
            self.amqpConnection = amqplib.connect(uri, amqpConnectionOptions, function (err, conn)
            {
                if (err)
                {
                    debug('Major error while connecting to RabbitMQ: ', err.toString());
                    self.emit('error', err);
                    reject(err);
                }
                else
                {
                    // create a upon which we will do our business
                    var amqpChannel = conn.createChannel();

                    var amqpExchangeOptions = {
                        durable:    true,
                        internal:   false,
                        autoDelete: false
                    };

                    self.amqpExchangeName = opts.prefix + "-socket.io";

                    amqpChannel.assertExchange(self.amqpExchangeName, 'direct', amqpExchangeOptions, function (err, exchange)
                    {
                        if (err)
                        {
                            debug('Major error while creating the Socket.io exchange on RabbitMQ: ', err.toString());
                            self.emit('error', err);
                            reject(err);
                        }
                        else
                        {
                            var incomingMessagesQueue = {
                                exclusive:  true,
                                durable:    false,
                                autoDelete: true
                            };

                            amqpChannel.assertQueue(opts.queueName, incomingMessagesQueue, function (err, queue)
                            {
                                if (err)
                                {
                                    debug('Major error while creating the local Socket.io queue on RabbitMQ: ', err.toString());
                                    self.emit('error', err);
                                    reject(err);
                                }
                                else
                                {
                                    self.amqpIncomingQueue = queue.queue;

                                    self.globalRoomName = getChannelName(prefix, self.nsp.name);
                                    amqpChannel.bindQueue(self.amqpIncomingQueue, self.amqpExchangeName, self.globalRoomName, {}, function (err)
                                    {
                                        if (err)
                                        {
                                            debug('Major error while binding the local Socket.io queue on to the Socket.io exchange for the global-room on RabbitMQ: ',
                                                err.toString());
                                            self.emit('error', err);
                                            reject(err);
                                        }
                                        else
                                        {
                                            amqpChannel.consume(self.amqpIncomingQueue, function (msg)
                                            {
                                                self.onmessage(msg.content);
                                            }, {noAck: true}, function (err, ok)
                                            {
                                                if (err)
                                                {
                                                    debug('Major error while setting up the consumer on local RabbitMQ connections: ', err.toString());
                                                    self.emit('error', err);
                                                    reject(err);
                                                }
                                                else
                                                {
                                                    self.amqpConsumerID = ok.consumerTag;
                                                    resolve(amqpChannel);
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            });
        });

        self.connected.catch(function(err)
        {
            console.error("Error in socket.io-amqp: " + err.toString());
            if(onNamespaceInitializedCallback)
            {
                return onNamespaceInitializedCallback(err, nsp);
            }
        });

        self.connected.done(function()
        {
            if(onNamespaceInitializedCallback)
            {
                return onNamespaceInitializedCallback(null, nsp);
            }
        });
    }

    /**
     * Inherits from `Adapter`.
     */

    AMQPAdapter.prototype.__proto__ = Adapter.prototype;

    /**
     * Called with a subscription message
     *
     * @api private
     */

    AMQPAdapter.prototype.onmessage = function (msg)
    {
        var args = msgpack.decode(msg);
        var packet;

        if (this.amqpConsumerID == args.shift())
        {
            return debug('ignore same consumer id');
        }

        packet = args[0];

        if (packet && packet.nsp === undefined)
        {
            packet.nsp = '/';
        }

        if (!packet || packet.nsp != this.nsp.name)
        {
            return debug('ignore different namespace');
        }

        args.push(true);

        Adapter.prototype.broadcast.apply(this, args);
    };


    /**
     * Subscribe client to room messages.
     *
     * @param {String} client id
     * @param {String} room
     * @param {Function} callback (optional)
     * @api public
     */

    AMQPAdapter.prototype.add = function (id, room, fn)
    {
        debug('adding %s to %s ', id, room);
        var self = this;

        self.connected.done(function(amqpChannel)
        {
            var needToSubscribe = !self.rooms[room];
            Adapter.prototype.add.call(self, id, room);
            var channel = getChannelName(prefix, self.nsp.name, room);

            if (needToSubscribe)
            {
                amqpChannel.bindQueue(self.amqpIncomingQueue, self.amqpExchangeName, channel, {}, function(err) {
                    if (err) {
                        self.emit('error', err);
                        if (fn) {
                            fn(err);
                        }
                        return;
                    }
                    if (fn) {
                        fn(null);
                    }
                });
            }
        });
    };

    /**
     * Broadcasts a packet.
     *
     * @param {Object} packet packet to emit
     * @param {Object} opts options
     * @param {Boolean} remote whether the packet came from another node
     * @api public
     */

    AMQPAdapter.prototype.broadcast = function (packet, opts)
    {
        Adapter.prototype.broadcast.call(this, packet, opts);
        var self = this;

        self.connected.done(function(amqpChannel)
        {
            if (opts.rooms)
            {
                opts.rooms.forEach(function (room)
                {
                    var chn = getChannelName(prefix, packet.nsp, room);
                    var msg = msgpack.encode([self.amqpConsumerID, packet, opts]);
                    amqpChannel.publish(self.amqpExchangeName, chn, msg);
                });
            }
            else
            {
                var msg = msgpack.encode([self.amqpConsumerID, packet, opts]);
                amqpChannel.publish(self.amqpExchangeName, self.globalRoomName, msg);
            }
        });
    };

    /**
     * Unsubscribe client from room messages.
     *
     * @param {String} session id
     * @param {String} room id
     * @param {Function} callback (optional)
     * @api public
     */

    AMQPAdapter.prototype.del = function (id, room, fn)
    {
        debug('removing %s from %s', id, room);

        var self = this;

        self.connected.done(function(amqpChannel)
        {
            Adapter.prototype.del.call(self, id, room);
            if (!self.rooms[room])
            {
                var channel = getChannelName(prefix, self.nsp.name, room);

                amqpChannel.unbindQueue(self.amqpIncomingQueue, self.amqpExchangeName, channel, {}, function (err)
                {
                    if (err)
                    {
                        self.emit('error', err);
                        if (fn)
                        {
                            fn(err);
                        }
                        return;
                    }
                    if (fn)
                    {
                        fn(null);
                    }
                });
            }
            else
            {
                if (fn)
                {
                    process.nextTick(fn.bind(null, null));
                }
            }
        });
    };

    /**
     * Unsubscribe client completely.
     *
     * @param {String} client id
     * @param {Function} callback (optional)
     * @api public
     */

    AMQPAdapter.prototype.delAll = function (id, fn)
    {
        debug('removing %s from all rooms', id);

        var self = this;

        self.connected.done(function(amqpChannel)
        {
            var rooms = self.sids[id];

            Adapter.prototype.delAll.call(self, id);

            if (!rooms)
            {
                return process.nextTick(fn.bind(null, null));
            }

            async.each(Object.keys(rooms), function (room, next)
            {
                if (!self.rooms[room])
                {
                    var channel = getChannelName(prefix, self.nsp.name, room);

                    amqpChannel.unbindQueue(self.amqpIncomingQueue, self.amqpExchangeName, channel, {}, function (err)
                    {
                        if (err)
                        {
                            self.emit('error', err);
                            return next(err);
                        }
                        else
                        {
                            next();
                        }
                    });
                }
                else
                {
                    process.nextTick(next);
                }
            }, function (err)
            {
                if (err)
                {
                    self.emit('error', err);
                    if (fn)
                    {
                        fn(err);
                    }
                    return;
                }
                delete self.sids[id];
                if (fn)
                {
                    fn(null);
                }
            });
        });
    };

    function getChannelName() {
        return Array.prototype.join.call(arguments, opts.channelSeperator) + opts.channelSeperator;
    }

    return AMQPAdapter;

}
