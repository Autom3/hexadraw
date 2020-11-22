const context = {
  username: 'user' + parseInt(Math.random() * 100000),
  token: null,
  eventSource: null,
  peers: {},
  channels: {}
}

const rtcConfig = {
  iceServers: [{
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:global.stun.twilio.com:3478'
    ]
  }]
}

async function getToken () {
  let res = await window.fetch('/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: context.username
    })
  })
  let data = await res.json()
  context.token = data.token
}

async function connect () {
  await getToken()
  context.eventSource = new window.EventSource(`/connect?token=${context.token}`)
  context.eventSource.addEventListener('add-peer', addPeer, false)
  context.eventSource.addEventListener('remove-peer', removePeer, false)
  context.eventSource.addEventListener('session-description', sessionDescription, false)
  context.eventSource.addEventListener('ice-candidate', iceCandidate, false)
  context.eventSource.addEventListener('connected', (user) => {
    context.user = user
  })
}

function addPeer (data) {
  let message = JSON.parse(data.data)
  if (context.peers[message.peer.id]) {
    return
  }

  let peer = new window.RTCPeerConnection(rtcConfig)
  context.peers[message.peer.id] = peer

  peer.onicecandidate = function (event) {
    if (event.candidate) {
      relay(message.peer.id, 'ice-candidate', event.candidate)
    }
  }

  if (message.offer) {
    let channel = peer.createDataChannel('updates')
    channel.onmessage = function (event) {
      window.onPeerData(message, event.data)
    }
    context.channels[message.peer.id] = channel
    createOffer(message.peer.id, peer)
  } else {
    peer.ondatachannel = function (event) {
      context.channels[message.peer.id] = event.channel
      event.channel.onmessage = function (evt) {
        window.onPeerData(message, evt.data)
      }
    }
  }
}

async function createOffer (peerId, peer) {
  let offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  await relay(peerId, 'session-description', offer)
}

function relay (peerId, event, data) {
  return window.fetch(`/relay/${peerId}/${event}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${context.token}`
    },
    body: JSON.stringify(data)
  })
}

function broadcast (data) {
  for (let peer of Object.values(context.channels)) {
    if (peer.readyState === 'open') {
      peer.send(data)
    }
  }
}

function removePeer (data) {
  let message = JSON.parse(data.data)
  if (context.peers[message.peer.id]) {
    context.peers[message.peer.id].close()
  }

  delete context.peers[message.peer.id]
}

async function sessionDescription (data) {
  let message = JSON.parse(data.data)
  let peer = context.peers[message.peer.id]

  let remoteDescription = new window.RTCSessionDescription(message.data)
  await peer.setRemoteDescription(remoteDescription)
  if (remoteDescription.type === 'offer') {
    let answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    await relay(message.peer.id, 'session-description', answer)
  }
}

function iceCandidate (data) {
  let message = JSON.parse(data.data)
  let peer = context.peers[message.peer.id]
  peer.addIceCandidate(new window.RTCIceCandidate(message.data))
}

connect()
