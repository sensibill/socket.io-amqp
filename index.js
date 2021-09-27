'use strict';
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

const Adapter = require('socket.io-adapter'),
    amqplib = require('amqplib'),
    debug = require('debug')('socket.io-amqp'),
    msgpack = require('msgpack-js'),
    underscore = require('underscore'),
    when = require('when');

const noOp = function ()
{
    // noOp
};

/**
 * Module exports.
 */

module.exports = adapter;

/**
 * Returns an AMQP adapter class
 *
 * @param {String}  uri AMQP uri
 * @param {Object}  opts  Options for the connection.
 * @param {String}  [opts.queueName='']
 * @param {String}  [opts.channelSeperator='#']
 * @param {String}  [opts.prefix='']
 * @param {Boolean} [opts.useInputExchange=false]
 * @param {function} onNamespaceInitializedCallback This is a callback function that is called everytime sockets.io opens a
 *                                     new namespace. Because a new namespace requires new queues and exchanges,
 *                                     you can get a callback to indicate the success or failure here. This
 *                                     callback should be in the form of function (err, nsp), where err is
 *                                     the error, and nsp is the namespace. If your code needs to wait until
 *                                     sockets.io is fully set up and ready to go, you can use this.
 *
 * Following options are accepted:
 *      - prefix: A prefix for all exchanges,queues, and topics created by the module on RabbitMQ.
 *
 *
 * @api public
 */

function adapter(uri, opts, onNamespaceInitializedCallback)
{
    opts = opts || {};

    underscore.defaults(opts, {
        queueName: '',
        channelSeperator: '#',
        prefix: '',
        useInputExchange: false,
        amqpConnectionOptions: {}
    });

    const prefix = opts.prefix;

    /**
     * Adapter constructor.
     *
     * @param {String} nsp name
     * @api public
     */

    function AMQPAdapter(nsp)
    {
        Adapter.call(this, nsp);

        const amqpConnectionOptions = opts.amqpConnectionOptions || {};

        const amqpExchangeOptions = {
            durable: true,
            internal: false,
            autoDelete: false
        };

        this.amqpExchangeName = opts.prefix + '-socket.io';
        this.amqpInputExchangeName = opts.prefix + '-socket.io-input';
        this.publishExchange = opts.useInputExchange ? this.amqpInputExchangeName : this.amqpExchangeName;

        let amqpChannel;
        let loggedOnce = false;

        function logErr(msg, err)
        {
            if (!loggedOnce)
            {
                loggedOnce = true;
                debug(msg, err);
            }
        }

        this.connected = amqplib.connect(uri, amqpConnectionOptions)
            .catch(err =>
            {
                logErr('Major error while connecting to RabbitMQ: ', err);
                throw err;
            })
            .then(conn =>
            {
                this.connection = conn;
                return conn.createChannel();
            })
            .then(ch =>
            {
                amqpChannel = ch;
                return amqpChannel.assertExchange(this.amqpExchangeName, 'direct', amqpExchangeOptions);
            })
            .then(() =>
            {
                if (!opts.useInputExchange)
                {
                    return;
                }
                return amqpChannel.assertExchange(this.amqpInputExchangeName, 'fanout', amqpExchangeOptions);
            })
            .then(() =>
            {
                if (!opts.useInputExchange)
                {
                    return;
                }
                return amqpChannel.bindExchange(this.amqpExchangeName, this.amqpInputExchangeName);
            })
            .catch(err =>
            {
                logErr('Major error while creating the Socket.io exchange on RabbitMQ: ', err);
                throw err;
            })
            .then(() =>
            {
                const incomingMessagesQueue = {
                    exclusive: true,
                    durable: false,
                    autoDelete: true
                };
                return amqpChannel.assertQueue(opts.queueName, incomingMessagesQueue);
            })
            .then(queue =>
            {
                this.amqpIncomingQueue = queue.queue;
            })
            .catch(err =>
            {
                logErr('Major error while creating the local Socket.io queue on RabbitMQ: ', err);
                throw err;
            })
            .then(() =>
            {
                this.globalRoomName = getChannelName(prefix, this.nsp.name);
                return amqpChannel.bindQueue(this.amqpIncomingQueue, this.amqpExchangeName, this.globalRoomName);
            })
            .catch(err =>
            {
                logErr('Major error while binding the local Socket.io queue on to the Socket.io exchange for the global-room on RabbitMQ: ', err);
                throw err;
            })
            .then(() => amqpChannel.consume(this.amqpIncomingQueue, msg => this.onmessage(msg.content), { noAck: true }))
            .then(ok =>
            {
                this.amqpConsumerID = ok.consumerTag;
            })
            .catch(err =>
            {
                logErr('Major error while setting up the consumer on local RabbitMQ connections: ', err);
                throw err;
            })
            .then(() => amqpChannel);

        this.connected.catch(err =>
        {
            debug('Error in socket.io-amqp: ' + err.toString());
            if (onNamespaceInitializedCallback)
            {
                return onNamespaceInitializedCallback(err, nsp);
            }
        });

        this.connected.done(function ()
        {
            if (onNamespaceInitializedCallback)
            {
                return onNamespaceInitializedCallback(null, nsp);
            }
        });
    }

    /**
     * Inherits from `Adapter`.
     */

    AMQPAdapter.prototype.__proto__ = Adapter.prototype;

    AMQPAdapter.prototype.closeConnection = function ()
    {
        return this.connection.close();
    };

    /**
     * Called with a subscription message
     *
     * @api private
     */

    AMQPAdapter.prototype.onmessage = function (msg)
    {
        const args = msgpack.decode(msg);

        if (this.amqpConsumerID == args.shift())
        {
            return debug('ignore same consumer id');
        }

        const packet = args[0];

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
     * Adds a socket to a list of room.
     *
     * @param {String} socket id
     * @param {String} rooms
     * @param {Function} callback
     * @api public
     */

    AMQPAdapter.prototype.addAll = function (id, rooms, fn)
    {
        debug('adding %s to %s ', id, rooms);
        fn = fn || noOp;
        this.connected
            .then(amqpChannel =>
                when.map(rooms, room =>
                {
                    const needToSubscribe = !this.rooms[room];
                    Adapter.prototype.addAll.call(this, id, [room]);
                    const channel = getChannelName(prefix, this.nsp.name, room);

                    if (!needToSubscribe)
                    {
                        return;
                    }

                    return amqpChannel.bindQueue(this.amqpIncomingQueue, this.amqpExchangeName, channel, {});
                })
            )
            .done(() => fn(), err =>
            {
                this.emit('error', err);
                fn(err);
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
        this.connected
            .then(amqpChannel =>
            {
                if (opts.rooms && opts.rooms.length !== 0)
                {
                    return when.map(opts.rooms, room =>
                    {
                        const chn = getChannelName(prefix, packet.nsp, room);
                        const msg = msgpack.encode([this.amqpConsumerID, packet, opts]);
                        return amqpChannel.publish(this.publishExchange, chn, msg);
                    });
                }
                else
                {
                    const msg = msgpack.encode([this.amqpConsumerID, packet, opts]);
                    return amqpChannel.publish(this.publishExchange, this.globalRoomName, msg);
                }
            })
            .done();
    };

    /**
     * Unsubscribe client from room messages.
     *
     * @param {String} id Session Id
     * @param {String} room Room Id
     * @param {Function} fn (optional) callback
     * @api public
     */

    AMQPAdapter.prototype.del = function (id, room, fn)
    {
        debug('removing %s from %s', id, room);
        fn = fn || noOp;

        this.connected
            .then(amqpChannel =>
            {
                Adapter.prototype.del.call(this, id, room);
                if (!this.rooms[room])
                {
                    const channel = getChannelName(prefix, this.nsp.name, room);
                    return amqpChannel.unbindQueue(this.amqpIncomingQueue, this.amqpExchangeName, channel);
                }
            })
            .done(() => fn(), err =>
            {
                this.emit('error', err);
                fn(err);
            });
    };

    /**
     * Unsubscribe client completely.
     *
     * @param {String} id Client ID
     * @param {Function} fn (optional)
     * @api public
     */

    AMQPAdapter.prototype.delAll = function (id, fn)
    {
        debug('removing %s from all rooms', id);
        fn = fn || noOp;

        this.connected
            .then(amqpChannel =>
            {
                const rooms = this.sids[id] || {};
                Adapter.prototype.delAll.call(this, id);

                return when.map(Object.keys(rooms), roomId =>
                {
                    if (!this.rooms[roomId])
                    {
                        const channel = getChannelName(prefix, this.nsp.name, roomId);

                        return amqpChannel.unbindQueue(this.amqpIncomingQueue, this.amqpExchangeName, channel);
                    }
                });
            })
            .then(() =>
            {
                delete this.sids[id];
            })
            .done(() => fn(), err =>
            {
                this.emit('error', err);
                fn(err);
            });
    };

    function getChannelName()
    {
        return Array.prototype.join.call(arguments, opts.channelSeperator) + opts.channelSeperator;
    }

    return AMQPAdapter;

}
