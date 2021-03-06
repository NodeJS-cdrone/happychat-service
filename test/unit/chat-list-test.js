import { ok, equal, deepEqual } from 'assert'
import { EventEmitter } from 'events'
import { isFunction, isArray } from 'lodash/lang'
import { map } from 'lodash/collection'

import { ChatList } from '../../src/chat-list'
import { tick } from '../tick'
import io from '../mock-io'

const mockServer = () => {
	const server = new EventEmitter()
	server.io = io().server
	return server
}

describe( 'ChatList', () => {
	let chatlist
	let operators
	let customers
	const emitCustomerMessage = ( id = 'chat-id', text = 'hello' ) => {
		customers.emit( 'message', { id }, { text } )
	}

	beforeEach( () => {
		operators = mockServer()
		customers = mockServer()
		chatlist = new ChatList( { operators, customers, timeout: 30 } )
	} )

	it( 'should notify when new chat has started', ( done ) => {
		chatlist.once( 'chat.status', tick( ( status, { id } ) => {
			equal( status, 'pending' )
			equal( id, 'chat-id' )
			done()
		} ) )
		emitCustomerMessage()
	} )

	it( 'should request operator for chat', ( done ) => {
		operators.on( 'assign', tick( ( { id }, name, callback ) => {
			// chat is now pending an operator
			ok( chatlist._chats['chat-id'] )
			equal( chatlist._chats['chat-id'][0], 'pending' )
			equal( id, 'chat-id' )
			ok( isFunction( callback ) )
			done()
		} ) )
		emitCustomerMessage()
	} )

	it( 'should move chat to active when operator found', ( done ) => {
		operators.on( 'assign', tick( ( { id }, name, callback ) => {
			callback( null, { id: 'operator-id', socket: new EventEmitter() } )
		} ) )
		chatlist.on( 'found', tick( ( { id }, operator ) => {
			equal( id, 'chat-id' )
			equal( operator.id, 'operator-id' )
			equal( chatlist._chats[id][0], 'assigned' )
			deepEqual( chatlist._chats[id][2], operator )
			done()
		} ) )
		emitCustomerMessage()
	} )

	it( 'should timeout if no operator provided', () => new Promise( ( resolve ) => {
		chatlist.on( 'miss', tick( ( error, { id } ) => {
			equal( error.message, 'timeout' )
			equal( id, 'chat-id' )
			resolve()
		} ) )
		emitCustomerMessage()
	} ) )

	const assignOperator = ( operator_id, socket = new EventEmitter() ) => new Promise( ( resolve ) => {
		operators.once( 'assign', ( chat, room, callback ) => callback( null, { id: operator_id, socket } ) )
		chatlist.once( 'found', () => resolve() )
		emitCustomerMessage()
	} )

	describe( 'with customer connections', () => {
		var socket
		var operator_id = 'op'
		beforeEach( () => {
			// mock up some connected customer accounts
			chatlist._chats = {
				abd: [ 'pending', { id: 'abd', user: 'Pending' } ],
				123: [ 'assigned', { id: '123', user: 'Active' } ],
				xyz: [ 'abandoned', { id: 'xyz', user: 'Abandoned' } ]
			}
			socket = new EventEmitter()
		} )
		it( 'should send operator list of active connections', ( done ) => {
			socket.on( 'chats', tick( ( chats ) => {
				equal( chats.length, 3 )
				deepEqual( map( chats, ( { user } ) => user ), [ 'Active', 'Pending', 'Abandoned' ] )
				done()
			} ) )
			operators.emit( 'init', { user: { id: operator_id }, socket } )
		} )
	} )

	describe( 'with active chat', () => {
		const operator_id = 'operator_id'
		const chat = {id: 'the-id'}
		var socket = new EventEmitter()
		beforeEach( () => {
			chatlist._chats[ 'the-id' ] = [ 'assigned', chat, {id: operator_id} ]
			return assignOperator( operator_id, socket )
		} )

		it( 'should store assigned operator', () => {
			equal( chatlist._chats[chat.id][2].id, operator_id )
		} )

		it( 'should mark chats as abandoned when operator is completely disconnected', ( done ) => {
			operators.on( 'disconnect', tick( () => {
				ok( chatlist._chats[chat.id] )
				equal( chatlist._chats[chat.id][0], 'abandoned' )
				done()
			} ) )
			operators.emit( 'disconnect', { id: operator_id } )
		} )

		it( 'should allow operator to close chat', ( done ) => {
			operators.once( 'close', ( _chat, room, operator ) => {
				deepEqual( operator, { id: 'op-id' } )
				deepEqual( _chat, chat )
				equal( room, `customers/${chat.id}` )
				ok( !chatlist._chats[chat.id] )
				done()
			} )
			operators.emit( 'chat.close', 'the-id', { id: 'op-id' } )
		} )

		it( 'should request chat transfer', ( done ) => {
			const newOperator = { id: 'new-operator' }
			operators.once( 'transfer', ( _chat, operator, complete ) => {
				deepEqual( _chat, chat )
				deepEqual( operator, newOperator )
				ok( isFunction( complete ) )
				done()
			} )
			operators.emit( 'chat.transfer', chat.id, { id: operator_id }, newOperator )
		} )

		it( 'should timeout when transfering chat to unavailable operator', ( done ) => {
			const newOperator = { id: 'new-operator' }
			chatlist.once( 'miss', tick( ( error, _chat ) => {
				equal( error.message, 'timeout' )
				deepEqual( _chat, chat )
				done()
			} ) )
			operators.emit( 'chat.transfer', chat.id, { id: operator_id }, newOperator )
		} )

		it( 'should transfer chat to new operator', ( done ) => {
			const newOperator = { id: 'new-operator' }
			operators.once( 'transfer', ( _chat, op, success ) => {
				success( null, newOperator.id )
			} )
			chatlist.once( 'transfer', ( _chat, op ) => {
				deepEqual( _chat, chat )
				deepEqual( op, newOperator.id )
				done()
			} )
			operators.emit( 'chat.transfer', chat.id, { id: operator_id }, newOperator )
		} )

		it( 'should log message when chat is transferred', done => {
			const newOperator = { id: 'new-operator' }
			operators.once( 'message', tick( ( { id: chat_id }, operator, message ) => {
				equal( chat_id, chat.id )
				ok( message.id )
				ok( message.timestamp )
				equal( message.type, 'event' )
				equal( message.text, 'chat transferred' )
				deepEqual( message.meta.to, newOperator )
				deepEqual( message.meta.from, { id: operator_id } )
				done()
			} ) )
			operators.emit( 'chat.transfer', chat.id, { id: operator_id }, newOperator )
		} )

		it( 'should send message when operator joins', done => {
			const newOperator = { id: 'joining-operator' }
			operators.once( 'message', tick( ( { id: chat_id }, operator, message ) => {
				equal( chat_id, chat.id )
				ok( message.id )
				deepEqual( message.meta.operator, newOperator )
				done()
			} ) )
			operators.emit( 'chat.join', chat.id, newOperator )
		} )

		it( 'should send message when operator leaves', done => {
			const newOperator = { id: 'leaving-operator' }
			operators.once( 'message', tick( ( { id: chat_id }, operator, message ) => {
				equal( chat_id, chat.id )
				deepEqual( message.meta.operator, newOperator )
				ok( message )
				done()
			} ) )
			operators.emit( 'chat.leave', chat.id, newOperator )
		} )

		it( 'should send a message when operator closes chat', done => {
			operators.once( 'message', tick( ( _chat, { id }, message ) => {
				equal( id, operator_id )
				deepEqual( _chat, chat )
				equal( message.type, 'event' )
				equal( message.meta.by.id, operator_id )
				done()
			} ) )
			operators.emit( 'chat.close', chat.id, { id: operator_id } )
		} )
	} )

	describe( 'with abandoned chat', () => {
		it( 'should reassign operator and make chats active', ( done ) => {
			const operator_id = 'operator-id'
			const chat_id = 'chat-id'
			const socket = new EventEmitter()
			chatlist._chats = { 'chat-id': [ 'abandoned', { id: chat_id }, { id: operator_id } ] }

			operators.on( 'recover', tick( ( operator, chats, complete ) => {
				complete()
				ok( operator )
				ok( operator.socket )
				ok( operator.user )
				ok( isArray( chats ) )
				ok( isFunction( complete ) )
				equal( chats.length, 1 )
				equal( chatlist._chats[chat_id][0], 'assigned' )
				done()
			} ) )
			operators.emit( 'init', { user: { id: operator_id }, socket } )
		} )
	} )
} )
