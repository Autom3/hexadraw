// Big thanks to https://github.com/nyxtom/drawing-webrtc and https://www.redblobgames.com/grids/hexagons

const { promisify } = require('util')
const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')
const jwt = require('jsonwebtoken')
const uuid = require('uuid')
const dotenv = require('dotenv')
const redis = require('redis')

dotenv.config()

const app = express()
app.use(bodyParser.json())

const server = http.createServer(app)
const clients = {}

const redisClient = redis.createClient()

const asyncRedisClient = {
  del: promisify(redisClient.del).bind(redisClient),
  get: promisify(redisClient.get).bind(redisClient),
  incr: promisify(redisClient.incr).bind(redisClient),
  publish: promisify(redisClient.publish).bind(redisClient),
  sadd: promisify(redisClient.sadd).bind(redisClient),
  set: promisify(redisClient.set).bind(redisClient),
  setnx: promisify(redisClient.setnx).bind(redisClient),
  smembers: promisify(redisClient.smembers).bind(redisClient),
  srem: promisify(redisClient.srem).bind(redisClient)
}

redisClient.on('ready', async () => {
  await asyncRedisClient.setnx('hexcount', -1)
})

async function disconnected (client) {
  delete clients[client.id]
  await asyncRedisClient.del(`messages:${client.id}`)
  await asyncRedisClient.del(`hexclient:${client.id}`)
  await asyncRedisClient.del(`hex:${client.hex.getHexId()}`)

  let msg = JSON.stringify({
    event: 'remove-peer',
    data: {
      peer: client.user
    }
  })
  await Promise.all(client.peers.map(async peer => {
    if (peer.id !== client.id) {
      await redisClient.publish(`messages:${peer.id}`, msg)
    }
  }))
}

function auth (req, res, next) {
  let token
  if (req.headers.authorization) {
    token = req.headers.authorization.split(' ')[1]
  } else if (req.query.token) {
    token = req.query.token
  }
  if (typeof token !== 'string') {
    return res.sendStatus(401)
  }

  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403)
    }
    req.user = user
    next()
  })
}

app.post('/access', (req, res) => {
  if (!req.body.username) {
    return res.sendStatus(403)
  }
  const user = {
    id: uuid.v4(),
    username: req.body.username
  }

  const token = jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: '3600s' })
  return res.json({ token: token })
})

app.get('/connect', auth, (req, res) => {
  if (req.headers.accept !== 'text/event-stream') {
    return res.sendStatus(404)
  }

  // write the event stream headers
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  // setup a client
  let client = {
    id: req.user.id,
    user: req.user,
    redis: redis.createClient(),
    emit: (event, data) => {
      res.write(`id: ${uuid.v4()}\n`)
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
  }

  // cache the current connection until it disconnects
  clients[client.id] = client

  // subscribe to redis events for user
  client.redis.on('message', (channel, message) => {
    let msg = JSON.parse(message)
    client.emit(msg.event, msg.data)
  })
  client.redis.subscribe(`messages:${client.id}`)

  // emit the connected state
  client.emit('connected', { user: req.user })

  asyncRedisClient.get(`hexclient:${client.id}`).then(async (hexId) => {
    let hex
    if (hexId === null) {
      hex = await getNewEmptyHex()
      await asyncRedisClient.set(`hexclient:${client.id}`, hex.getHexId())
      await asyncRedisClient.set(`hex:${hex.getHexId()}`, client.id)
    } else {
      hex = Hex.fromHexId(hexId)
    }

    client.hex = hex
    console.log(client.user, client.hex)

    client.peers = []

    for (let i = 0; i < 6; i++) {
      const neighbourHexId = client.hex.getNeighbour(i).getHexId()
      const neighbourClientId = await asyncRedisClient.get(`hex:${neighbourHexId}`)

      client.peers.push({ id: neighbourClientId, direction: i })
    }

    client.peers.forEach(peer => {
      redisClient.publish(`messages:${peer.id}`, JSON.stringify({
        event: 'add-peer',
        data: {
          peer: req.user,
          offer: false,
          direction: (peer.direction + 3) % 6
        }
      }))
      redisClient.publish(`messages:${req.user.id}`, JSON.stringify({
        event: 'add-peer',
        data: {
          peer: { id: peer.id },
          offer: true,
          direction: peer.direction
        }
      }))
    })
  })

  // ping to the client every so often
  setInterval(() => {
    client.emit('ping')
  }, 10000)

  req.on('close', () => {
    disconnected(client)
  })
})

class Hex {
  constructor (x, y, z) {
    if (x + y + z !== 0) {
      throw new Error('The sum of x, y and z needs to be 0')
    }
    this.x = x
    this.y = y
    this.z = z
  }

  getNeighbour (direction) {
    return this.add(Hex.direction(direction))
  }

  add (other) {
    return new Hex(this.x + other.x, this.y + other.y, this.z + other.z)
  }

  scale (range) {
    return new Hex(this.x * range, this.y * range, this.z * range)
  }

  getHexId () {
    if (!this.hexId) {
      const ring = Math.max(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z))
      if (ring <= 0) {
        return 0
      }

      const ringBegin = 3 * ring * (ring - 1) + 1
      let segment
      let segmentIndex
      if (this.x >= 0 && this.y > 0 && this.z < 0) {
        segment = 0
        segmentIndex = ring - 1 - Math.abs(this.x)
      } else if (this.x < 0 && this.y > 0 && this.z <= 0) {
        segment = 1
        segmentIndex = ring - 1 - Math.abs(this.z)
      } else if (this.x < 0 && this.y >= 0 && this.z > 0) {
        segment = 2
        segmentIndex = ring - 1 - Math.abs(this.y)
      } else if (this.x <= 0 && this.y < 0 && this.z > 0) {
        segment = 3
        segmentIndex = ring - 1 - Math.abs(this.x)
      } else if (this.x > 0 && this.y < 0 && this.z >= 0) {
        segment = 4
        segmentIndex = ring - 1 - Math.abs(this.z)
      } else {
        segment = 5
        segmentIndex = ring - 1 - Math.abs(this.y)
      }

      this.hexId = ringBegin + segment * ring + segmentIndex
    }

    return this.hexId
  }

  static fromHexId (hexId) {
    if (hexId <= 0) {
      return new Hex(0, 0, 0)
    }

    // Big thanks to @Vobtex#6923
    const ring = Math.ceil((-1 + Math.sqrt(8 * (hexId / 6) + 1)) / 2)

    const index = hexId - 6 * ring * (ring - 1) / 2
    const segment = Math.ceil(index / ring) - 1

    // Go out to the last hex of the segment of the ring, then step backwards (oposite the segment direction)
    return Hex.direction(segment).scale(ring).add(Hex.direction((segment + 1) % 6).scale(index - ring - ring * segment))
  }

  static direction (direction) {
    return cubeDirections[direction]
  }
}
const cubeDirections = [new Hex(0, +1, -1), new Hex(-1, +1, 0), new Hex(-1, 0, +1), new Hex(0, -1, +1), new Hex(+1, -1, 0), new Hex(+1, 0, -1)]

async function getNewEmptyHex () {
  const hexId = await asyncRedisClient.incr('hexcount')
  return Hex.fromHexId(hexId)
}

app.post('/relay/:peerId/:event', auth, (req, res) => {
  let peerId = req.params.peerId
  let msg = {
    event: req.params.event,
    data: {
      peer: req.user,
      data: req.body
    }
  }
  redisClient.publish(`messages:${peerId}`, JSON.stringify(msg))
  return res.sendStatus(200)
})

app.use(express.static(`${__dirname}/public`))

server.listen(process.env.PORT || 8081, () => {
  console.log(`Started server on port ${server.address().port}`)
})
