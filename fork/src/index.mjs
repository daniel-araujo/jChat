import express from 'express'
import cors from 'cors'
import http from 'http'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { twitchApiRequest } from "../../../../services/twitch-api-request/src/index.mjs"
import { OAuthSession } from "../../../../services/oauth-local/src/index.mjs"
import { HttpProxy } from '../../../common/src/http-proxy.mjs'
import { twentyEightApiFetch, TwentyEightApiFetchServerError, TwentyEightApiFetchClientError } from '../../../../services/twenty-eight-api-fetch/src/index.mjs'
import "./dotenv.mjs"

async function twitchUserId(session, login) {
  console.log(`Retrieving id of ${login}`)

  let response = await session.try(({ accessToken, clientId }) => twitchApiRequest({
    url: 'https://api.twitch.tv/helix/users',
    query: {
      login
    },
    clientId,
    accessToken
  }))

  if (response.data.length === 0) {
    throw new Error(`Could not find ${login}`)
  }

  return response.data.data[0].id
}

async function kickUserInfo(username) {
  let { data } = await twentyEightApiFetch({
    url: `${process.env.KICK_FORBIDDEN_HTTP_API_PREFIX}/channel/id`,
    query: {
      channel: username
    }
  })

  return data
}

let session = new OAuthSession({
  id: 'jchat-fork',
  codeUrl: 'https://id.twitch.tv/oauth2/authorize',
  tokenUrl: 'https://id.twitch.tv/oauth2/token',
  clientId: process.env.TWITCH_CLIENT_ID,
  clientSecret: process.env.TWITCH_CLIENT_SECRET,
  scopes: []
})

await session.start()

let twitchChannelId = await twitchUserId(session, process.env.TWITCH_CHANNEL)
let kickChannelInfo = await kickUserInfo(process.env.KICK_CHANNEL)

const app = express()
const server = http.createServer(app).listen(process.env.PORT)
const httpProxy = new HttpProxy({ server })

httpProxy.websocketProxy({
  path: '/kick/chat',
  target: 'wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.4.0&flash=false',
})

httpProxy.websocketProxy({
  path: '/color',
  target: `${process.env.CENTRAL_WS_API_PREFIX}/color`
})

app.use(express.json());
app.use(cors());

function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res).catch((error) => {
      next(error)
    })
  }
}

app.get('/info', asyncHandler(async (req, res) => {
  res.json({
    twitch: {
      channelName: process.env.TWITCH_CHANNEL,
      channelId: twitchChannelId,
    },
    kick: {
      channelName: process.env.KICK_CHANNEL,
      channelId: kickChannelInfo.channelId,
      chatroomId: kickChannelInfo.chatroomId,
    }
  })
}))

app.use('/fork/customcss.css', express.static('./customcss.css'))
app.use('/v2', express.static('../v2'))
app.use('/img', express.static('../img'))
app.use('/styles', express.static('../styles'))
app.use('/settings.js', express.static('../settings.js'))
app.use('/utils.js', express.static('../utils.js'))

app.get('/user-badges', asyncHandler(async (req, res) => {
  let response = await twentyEightApiFetch({
    url: `${process.env.CENTRAL_HTTP_API_PREFIX}/custom-badges/twitch`,
    query: {}
  })

  res.json(response.data)
}))

app.get('/cheermotes', asyncHandler(async (req, res) => {
  let { broadcaster_id } = req.query

  let response = await session.try(({ accessToken, clientId }) => twitchApiRequest({
    url: 'https://api.twitch.tv/helix/bits/cheermotes',
    query: {
      broadcaster_id
    },
    accessToken,
    clientId,
  }))

  res.json(response.data)
}))

app.use(function (err, req, res, next) {
  console.error(err.stack)

  res.status(500).json({
    name: 'UnknownServerError',
    message: 'Unknown Server error.'
  })
})
