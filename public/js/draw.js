const canvas = document.getElementById('canvas')
const canvasContext = canvas.getContext('2d')
const neighbours = []

function randomColor () {
  const r = Math.random() * 255
  const g = Math.random() * 255
  const b = Math.random() * 255
  return `rgb(${r}, ${g}, ${b})`
}

const color = randomColor()
let currentForce = 1
let lastPoint
let region

function resize () {
  const margin = 10
  canvas.width = Math.min(window.innerHeight, window.innerWidth) - margin
  canvas.height = Math.min(window.innerHeight, window.innerWidth) - margin
  canvas.style.marginTop = `${margin / 2}px`
  clear()
}

function drawHexagon (x, y, width, height) {
  canvasContext.beginPath()
  canvasContext.moveTo(x, y + height / 2)
  canvasContext.lineTo(x + width / 4, y)
  canvasContext.lineTo(x + (3 * width) / 4, y)
  canvasContext.lineTo(x + width, y + height / 2)
  canvasContext.lineTo(x + (3 * width) / 4, y + height)
  canvasContext.lineTo(x + width / 4, y + height)
  canvasContext.lineTo(x, y + height / 2)
  canvasContext.strokeStyle = 'black'
  canvasContext.lineWidth = 3
  canvasContext.stroke()
}

function clear () {
  canvasContext.clearRect(0, 0, canvas.width, canvas.height)

  const margin = 3
  const height = (canvas.height / 3) - margin
  const side = height / Math.sqrt(3)
  const width = side * 2

  neighbours.push(
    { directionOffsets: { x: 0, y: -height } },
    { directionOffsets: { x: -(3 * width) / 4, y: -height / 2 } },
    { directionOffsets: { x: -(3 * width) / 4, y: height / 2 } },
    { directionOffsets: { x: 0, y: height } },
    { directionOffsets: { x: (3 * width) / 4, y: height / 2 } },
    { directionOffsets: { x: (3 * width) / 4, y: -height / 2 } }
  )

  drawHexagon(margin / 2 + (3 * width) / 4, margin / 2, width, height)
  drawHexagon(margin / 2, margin / 2 + height / 2, width, height)
  drawHexagon(margin / 2, margin / 2 + (3 * height) / 2, width, height)
  drawHexagon(margin / 2 + (3 * width) / 4, margin / 2 + 2 * height, width, height)
  drawHexagon(margin / 2 + (3 * width) / 2, margin / 2 + height / 2, width, height)
  drawHexagon(margin / 2 + (3 * width) / 2, margin / 2 + (3 * height) / 2, width, height)

  region = new window.Path2D()
  region.moveTo(margin / 2 + (3 * width) / 4, margin / 2 + (3 * height) / 2)
  region.lineTo(margin / 2 + width, margin / 2 + 2 * height)
  region.lineTo(margin / 2 + (3 * width) / 2, margin / 2 + 2 * height)
  region.lineTo(margin / 2 + (7 * width) / 4, margin / 2 + (3 * height) / 2)
  region.lineTo(margin / 2 + (3 * width) / 2, margin / 2 + height)
  region.lineTo(margin / 2 + width, margin / 2 + height)
  region.lineTo(margin / 2 + (3 * width) / 4, margin / 2 + (3 * height) / 2)
}

function force (event) {
  currentForce = event.webkitForce || 1
}

function clearPeer (peer) {

}

function drawPeer (data, peer) {
  data.x += neighbours[peer.direction].directionOffsets.x
  data.y += neighbours[peer.direction].directionOffsets.y

  if (!neighbours[peer.direction].lastPoint) {
    neighbours[peer.direction].lastPoint = { x: data.x, y: data.y }
    return
  }

  data.lastPoint = neighbours[peer.direction].lastPoint

  draw(data, false)

  neighbours[peer.direction].lastPoint.x = data.x
  neighbours[peer.direction].lastPoint.y = data.y
}

function draw (data, clip) {
  canvasContext.beginPath()
  if (clip) {
    canvasContext.save()
    canvasContext.clip(region)
  }
  canvasContext.moveTo(data.lastPoint.x, data.lastPoint.y)
  canvasContext.lineTo(data.x, data.y)
  canvasContext.strokeStyle = data.color
  canvasContext.lineWidth = Math.pow(data.force, 4) * 2
  canvasContext.lineCap = 'round'
  canvasContext.stroke()
  canvasContext.closePath()
  if (clip) {
    canvasContext.restore()
  }
}

function key (event) {
  if (event.key === 'Backspace') {
    clear()
    window.broadcast(JSON.stringify({ event: 'clear' }))
  }
}

function onPeerData (peer, data) {
  let msg = JSON.parse(data)
  if (msg.event === 'draw') {
    drawPeer(msg, peer)
  } else if (msg.event === 'clear') {
    clearPeer(peer)
  }
}

function up () {
  lastPoint = null
}

function move (event) {
  if (!event.buttons) {
    return
  }
  if (!lastPoint) {
    lastPoint = { x: event.offsetX, y: event.offsetY }
    return
  }

  draw({
    lastPoint,
    x: event.offsetX,
    y: event.offsetY,
    force: currentForce,
    color: color
  }, true)

  lastPoint = { x: event.offsetX, y: event.offsetY }

  window.broadcast(JSON.stringify({
    event: 'draw',
    x: event.offsetX,
    y: event.offsetY,
    force: currentForce,
    color: color
  }))
}

window.onresize = resize
window.onmousemove = move
window.onmouseup = up
window.onkeydown = key
window.onwebkitmouseforcechanged = force
resize()
