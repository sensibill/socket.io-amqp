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

const adapter = require('../index'),
    expect = require('expect.js'),
    http = require('http').Server,
    io = require('socket.io'),
    ioc = require('socket.io-client');

const RABBIT_MQ_URI = process.env.RABBIT_MQ_URI || 'amqp://localhost';

describe('socket.io-amqp', function ()
{
    this.timeout(1000);

    const sios = [];

    afterEach(function ()
    {
        sios.forEach((sio) =>
        {
            sio.close(() =>
            {
                for (const key in sio.nsps)
                {
                    setTimeout(sio.nsps[key].adapter.closeConnection, 1000);
                }
            });
        });
    });

    it('broadcasts', function (done)
    {
        create(function (server1, client1)
        {
            create(function (server2, client2)
            {
                client1.on('woot', function (a, b)
                {
                    expect(a).to.eql([]);
                    expect(b).to.eql({a: 'b'});
                    done();
                });
                server2.on('connection', function (c2)
                {
                    c2.broadcast.emit('woot', [], {a: 'b'});
                });
            });
        });
    });

    it('broadcasts to rooms', function (done)
    {
        create(function (server1, client1)
        {
            server1.on('connection', function (c1)
            {
                c1.join('woot');
            });

            client1.on('broadcast', function ()
            {
                setTimeout(done, 100);
            });

            create(function (server2, client2)
            {
                server2.on('connection', function (c2)
                {
                    // does not join, performs broadcast
                    c2.on('do broadcast', function ()
                    {
                        c2.broadcast.to('woot').emit('broadcast');
                    });
                });

                client2.on('broadcast', function ()
                {
                    throw new Error('Not in room');
                });

                create(function (server3, client3)
                {
                    server3.on('connection', function (c3)
                    {
                        // does not join, signals broadcast
                        client2.emit('do broadcast');
                    });

                    client3.on('broadcast', function ()
                    {
                        throw new Error('Not in room');
                    });
                });
            });
        });
    });

    // create a pair of socket.io server+client
    function create(nsp, fn)
    {
        const srv = http();
        const sio = io(srv);
        sios.push(sio);

        sio.adapter(adapter(RABBIT_MQ_URI, {prefix: 'unit-tests', useInputExchange: true}, function ()
        {
            srv.listen(function (err)
            {
                if (err)
                {
                    throw err;
                } // abort tests
                if ('function' == typeof nsp)
                {
                    fn = nsp;
                    nsp = '';
                }
                nsp = nsp || '/';
                const addr = srv.address();
                const url = 'http://localhost:' + addr.port + nsp;
                fn(sio.of(nsp), ioc(url));
            });
        }));
    }

});
