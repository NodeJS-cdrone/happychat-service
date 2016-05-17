import isFunction from 'lodash/isFunction'
import isEmpty from 'lodash/isEmpty'
import assign from 'lodash/assign'

import { ChatList } from './chat-list'
import { ChatLog } from './chat-log'

const debug = require( 'debug' )( 'tinkerchat:controller' )

// change a lib/customer message to what an agent client expects
const formatAgentMessage = ( author_type, author_id, context, { id, timestamp, text } ) => ( {
	id, timestamp, text,
	context,
	author_id,
	author_type
} )

const pure = ( ... args ) => args

const forward = ( dest ) => ( org, event, dstEvent, mapArgs = pure ) => {
	if ( isFunction( dstEvent ) ) {
		mapArgs = dstEvent
		dstEvent = event
	}
	if ( !dstEvent ) {
		dstEvent = event
	}
	org.on( event, ( ... args ) => dest.emit( dstEvent, ... mapArgs( ... args ) ) )
}

const isPromise = ( obj ) => {
	return obj && obj.constructor === Promise
}

export default ( { customers, agents, operators } ) => {
	const middlewares = []
	const toAgents = forward( agents )
	const chats = new ChatList( { customers, operators } )
	const log = new ChatLog()

	const runMiddleware = ( { origin, destination, chat, user, message } ) => new Promise( ( resolve, reject ) => {
		if ( isEmpty( middlewares ) ) {
			return resolve( message )
		}
		// copy the middlewar
		const context = middlewares.slice()
		debug( 'running middleware', context.length )
		// recursively run each middleware piping the result into
		// the next middleware
		const run = ( data, [ head, ... rest ] ) => {
			const result = head( data )
			const promise = isPromise( result ) ? result : Promise.resolve( result )
			promise
			.then( ( nextMessage ) => {
				debug( 'middleware complete', rest.length )
				if ( !isEmpty( rest ) ) {
					return run( assign( {}, data, { message: nextMessage } ), rest )
				}
				resolve( nextMessage )
			} )
			.catch( reject )
		}
		run( { origin, destination, chat, user, message }, context )
	} )

	chats
	.on( 'miss', ( e, { id } ) => {
		debug( 'failed to find operator', e, id, e.stack )
	} )
	.on( 'open', ( { id } ) => {
		debug( 'looking for operator', id )
	} )
	.on( 'found', ( channel, operator ) => {
		debug( 'found operator', channel.id, operator.id )
	} )
	.on( 'chat.status', ( status, chat ) => {
		debug( 'chats status changed', status, chat.id )
	} )

	toAgents( customers, 'join', 'customer.join' )
	toAgents( customers, 'leave', 'customer.leave' )

	customers.on( 'join', ( socketIdentifier, user, socket ) => {
		debug( 'emitting chat log' )
		log.findLog( user.id )
		.then( ( messages ) => socket.emit( 'log', messages ) )
	} )

	operators.on( 'join', ( chat, operator, socket ) => {
		debug( 'emitting chat log to operator', operator.id )
		log.findLog( chat.id )
		.then( ( messages ) => {
			socket.emit( 'log', chat, messages )
		} )
	} )

	customers.on( 'message', ( chat, message ) => {
		// broadcast the message to
		debug( 'customer message', chat.id, message.id )
		log.recordCustomerMessage( chat, message )
		.then( () => {
			runMiddleware( { origin: 'customer', destination: 'customer', chat, message } )
			.then( ( message ) => customers.emit( 'receive', chat, message ) )
			agents.emit( 'receive', formatAgentMessage( 'customer', chat.id, chat.id, message ) )
			operators.emit( 'receive', chat, message )
		} )
	} )

	operators.on( 'message', ( chat, operator, message ) => {
		debug( 'operator message', chat, message )
		log.recordOperatorMessage( chat, operator, message )
		.then( () => {
			agents.emit( 'receive', formatAgentMessage( 'operator', message.user.id, chat.id, message ) )
			operators.emit( 'receive', chat, message )
			customers.emit( 'receive', chat, message )
		} )
	} )

	agents.on( 'message', ( message ) => {
		const chat = { id: message.context }
		const formattedMessage = assign( {}, { author_type: 'agent' }, message )
		log.recordAgentMessage( chat, message )
		.then( () => {
			agents.emit( 'receive', assign( {}, { author_type: 'agent' }, message ) )
			operators.emit( 'receive', chat, formattedMessage )
			customers.emit( 'receive', chat, formattedMessage )
		} )
	} )

	const external = {
		middleware: ( middleware ) => {
			middlewares.push( middleware )
			return external
		},
		middlewares
	}

	return external
}

