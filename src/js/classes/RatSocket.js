// App Imports
import {
  isValidProperty,
  makeID,
} from '../helpers'


// Constants
const ACTION_ARRAY_LENGTH = 2
const RECONNECT_TIMEOUT = 5000
const REQUEST_ID_LENGTH = 32
const REQUEST_TIMEOUT = 60000
const REQUEST_TIMEOUT_SEC = 60
const MILLISECONDS_IN_SECOND = 1000


class RatSocket {
  /**
   * Websocket handler for the FuelRats API
   * @param  {String} uri - Address of the API to connect to.
   * @return {Object}     - Current instance of RatSocket
   */
  constructor (uri, token) {
    if (typeof uri !== 'string') {
      throw new TypeError('URI must be a string')
    }
    this.WSSUri = uri
    this.socket = null
    this.currentToken = token || null
    this.reconnected = false
    this.isAuthenticated = false
    this.openRequests = {}
    this.listeners = {}


    this.isRatSocket = {}
  }

  /* ====== Socket Handling  ====== */

  /**
   * Creates, opens, and handles the initial setup of the WebSocket client.
   *
   * @return {Promise} - Promise to be resolved when the API's welcome message is received.
   */
  connect (token) {
    if (typeof token !== 'string') {
      throw new TypeError('Invalid token string')
    }

    this.currentToken = token
    return new Promise((resolve, reject) => {
      const rejectTimeout = window.setTimeout(() => {
        window.console.error('RatSocket - Connection failed.')
        reject({
          context: this,
          data: {
            errors: [{ code: 408, detail: 'Server produced no response.', status: 'Request Timeout', title: 'Request Timeout' }],
            meta: {},
          },
        })
      }, REQUEST_TIMEOUT)

      this.once('connection', (context, data) => {
        window.clearTimeout(rejectTimeout)
        window.console.debug('RatSocket - Connection successful!')
        resolve({ context, data })
      }).once('ratsocket:error', (context, data) => {
        window.clearTimeout(rejectTimeout)
        reject({
          context,
          data: {
            errors: [{ code: 500, detail: data, status: 'Error.', title: 'Error.' }],
            meta: {},
          },
        })
      })

      this.socket = new WebSocket(`${this.WSSUri}?bearer=${token}`)
      this.socket.onopen = (data) => {
        this._onSocketOpen(data)
      }
      this.socket.onclose = (data) => {
        this._onSocketClose(data)
      }
      this.socket.onerror = (data) => {
        this._onSocketError(data)
      }
      this.socket.onmessage = (data) => {
        this._onSocketMessage(data)
      }
      window.console.debug('RatSocket - Socket opened, awaiting connection confirmation...')
    })
  }

  _reconnect () {
    if (this.currentToken === null) {
      window.console.debug('RatSocket - A reconnect was attempted, but no token was found!')
    } else {
      window.console.debug('RatSocket - Attempting reconnect with last known bearer token.... ', this)
      this.connect(this.currentToken)
    }
  }

  _onSocketOpen (data) {
    if (this.reconnected) {
      window.console.debug('RatSocket - Socket reconnected! ', data)
      this._emitEvent('ratsocket:reconnect', data)
      this.reconnected = false
      return
    }
    this._emitEvent('ratsocket:connect', data)
    window.console.debug('RatSocket - Socket Connected!', data)
  }

  _onSocketClose (dc) {
    if (dc.wasClean === false) {
      window.console.debug('RatSocket - Disconnected from API! Attempting to reconnect... ', dc)
      this._emitEvent('ratsocket:disconnect', dc)
      this.initComp = false
      setTimeout(() => {
        window.console.debug(this)
        this._reconnect()
      }, RECONNECT_TIMEOUT)
      this.reconnected = true
    }
  }

  _onSocketError (data) {
    window.console.error('RatSocket - Socket Error: ', data)
    this._emitEvent('ratsocket:error', data)
  }

  _onSocketMessage (data) {
    window.console.debug('RatSocket - Received message: ', data)

    const _data = JSON.parse(data.data)
    // Handle request responses
    if (typeof _data.meta.reqID === 'string' && Object.prototype.hasOwnProperty.call(this.openRequests, _data.meta.reqID)) {
      // If the message was the response to a request, then call the request's callback.
      window.console.debug(`RatSocket - Detected request response. closing request: ${_data.meta.reqID}`)
      this.openRequests[_data.meta.reqID](_data)
      delete this.openRequests[_data.meta.reqID]
    } else if (_data.meta.event) {
      // If the message wasn't a response to a request, and the message contains an event, then emit the event.
      this._emitEvent(_data.meta.event, _data)
    } else {
      // if neither of the above conditions are true, just spit it out as an error to the console. This shouldn't happen.
      window.console.error('RatSocket - Received an unknown message from the attached websocket: ', data)
    }
  }

  /* ====== Messaging ====== */

  /**
   * Sends the given JSON Object to the API.
   *
   * @param  {Object} data        - Object to be sent.
   * @param  {Array} data.action - Method to call on the API in the format of ['Controller','Method']
   * @param  {Object} data.data   - Serves as the message body to be sent to the given method
   * @param  {Object} data.meta   - Metadata to be returned with the message response.
   * @return {Object}             - Current instance of RatSocket
   */
  send (_data) {
    const data = { ..._data }
    if (this.socket.readyState !== 1) {
      if (this.socket.readyState > 1) {
        this._reconnect()
      }
      setTimeout(() => {
        this.send(data)
      })
      return this
    }
    if (!isValidProperty(data, 'action', 'array') || data.action.length > ACTION_ARRAY_LENGTH || data.action.length < 1) {
      throw new TypeError('Action array must be defined.')
    }
    if (!isValidProperty(data, 'data', 'object')) {
      data.data = {}
    }
    if (!isValidProperty(data, 'meta', 'object')) {
      data.meta = {}
    }

    window.console.debug('RatSocket - Sending message: ', data)
    this.socket.send(JSON.stringify(data))
    window.console.debug('RatSocket - Socket State post-send: ', this.socket)
    return this
  }

  /**
   * Promise 'wrapper' for RatSocket.send.
   *
   * @param  {Object}  data         - Object to be sent.
   * @param  {Object}  opts         - Request options. All options are optional.
   * @param  {Number}  opts.timeout - Time (in seconds) to wait before manually timing out the request.
   * @param  {String}  opts.reqID   - Override request ID generated by RatSocket.
   * @return {Promise}              - Promise to be resolved upon a response from the API
   */
  request (_data, opts = {}) {
    const data = { ..._data }
    if (!isValidProperty(data, 'meta', 'object')) {
      data.meta = {}
    }

    const requestID = opts.reqID || makeID(REQUEST_ID_LENGTH)
    data.meta.reqID = requestID

    return new Promise((resolve, reject) => {
      this.send(data)
      const timeout = window.setTimeout(() => {
        reject({
          context: this,
          data: {
            errors: [{ code: 408, detail: 'Server produced no response.', status: 'Request Timeout', title: 'Request Timeout' }],
            meta: data.meta,
          },
        })
      }, (opts.timeout || REQUEST_TIMEOUT_SEC) * MILLISECONDS_IN_SECOND)
      this.openRequests[requestID] = (res) => {
        window.clearTimeout(timeout)
        if (res.errors) {
          reject({ context: this, data: res })
        }
        resolve({ context: this, data: res })
      }
    })
  }

  /**
   * Pseudo-alias for RatSocket.request to send a preformatted subscribe message to the API.
   *
   * @param  {String}  streamName - Name of the information stream to subscribe to
   * @param  {Object}  opts       - See RatSocket.request() opts.
   * @return {Promise}            - Promise to resolved upon a successful response.
   */
  subscribe (streamName, opts) {
    return this.request({
      action: ['stream', 'subscribe'],
      id: streamName,
      data: {},
      meta: {},
    }, opts || {
      timeout: 15,
    })
  }

  /* ====== Event Handling ====== */

  /**
   * Adds listener for the given event name.
   *
   * @param  {String}   evt  - Name of the event to listen to.
   * @param  {Function} func - Function to be called on event.
   * @return {Object}        - Current instance of RatSocket.
   */
  on (evt, func) {
    if (typeof evt !== 'string' || func === null) {
      throw new TypeError('Invalid argument(s)')
    }

    if (!Object.prototype.hasOwnProperty.call(this.listeners, evt)) {
      this.listeners[evt] = []
    }

    this.listeners[evt].push(typeof func === 'object'
      ? func
      : {
        func,
        once: false,
      })

    return this
  }

  once (evt, func) {
    return this.on(evt, {
      func,
      once: true,
    })
  }

  /**
   * Removes a listener from the given event name.
   *
   * @param  {String}   evt  - Name of the event.
   * @param  {Function} func - Function to remove.
   * @return {Object}        - Current instance of RatSocket.
   */
  off (evt, func) {
    if (typeof evt !== 'string' || typeof func !== 'function') {
      throw new TypeError('Invalid argument(s)')
    }

    if (!Object.prototype.hasOwnProperty.call(this.listeners, evt)) {
      return this
    }

    const listenerIndex = this.listeners[evt].findIndex((listener) => listener.func === func)
    if (listenerIndex < 0) {
      return this
    }

    this.listeners[evt].splice(listenerIndex, 1)

    return this
  }

  /**
   * Executes all listeners of a given event name.
   *
   * @param  {String}  evt    - Name of the event to emit.
   * @param  {(*|*[])} [args] - Argument(s) to send with the event.
   * @return {Object}         - Current instance of RatSocket.
   */
  _emitEvent (evt, args) {
    if (typeof evt !== 'string') {
      throw new TypeError('Event must be string')
    }

    if (!Object.prototype.hasOwnProperty.call(this.listeners, evt)) {
      window.console.debug(`RatSocket - Event: '${evt}' has no listener. Returning...`)
      return this
    }

    const evtargs = [this]

    if (Array.isArray(args)) {
      evtargs.concat(args)
    } else {
      evtargs.push(args)
    }

    const evtListeners = this.listeners[evt]

    window.console.debug(`RatSocket - Executing listener functions for: ${evt} with args:`, args)
    evtListeners.forEach((listener) => {
      // Execute function and get response from it.
      const res = listener.func.apply(this, evtargs)

      // If the listener was set to run once, or returned as 'true', remove it from the listener list.
      if (listener.once === true || res === true) {
        this.off(evt, listener.func)
      }
    })

    return this
  }
}





export default RatSocket
