#!/usr/bin/env bash

set -euxo pipefail

cd "$(dirname "$0")/.."

container_id="$(docker run -d -p 35672:5672 rabbitmq:3.4.4)"

sleep 5
export RABBIT_MQ_URI='amqp://localhost:35672'

set +e
./node_modules/.bin/mocha test/*.js

err="$?"

set -e

docker kill "$container_id"
docker rm "$container_id"

exit "$err"
