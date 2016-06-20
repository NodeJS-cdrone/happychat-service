import customer from '../../src/customer'
import mockIO from '../mock-io'
import { contains, ok, equal, deepEqual } from '../assert'

const debug = require( 'debug' )( 'happychat:test:customer' )

describe( 'Customer Service', () => {
	let server, socket, client, customerEvents
	const mockUser = { id: 'abdefgh', username: 'ridley', displayName: 'Ridley', avatarURL: 'http://example.com/image' }
	let auth
	beforeEach( () => {
		( { server, socket, client } = mockIO() )
		auth = ( next = () => {} ) => {
			let events = customer( server ).on( 'connection', ( _socket, authUser ) => {
				authUser( null, mockUser )
				client.on( 'init', () => next() )
			} )
			server.emit( 'connection', socket )
			return events
		}
	} )

	describe( 'with authorized user', () => {
		beforeEach( ( next ) => {
			customerEvents = auth( next )
		} )

		it( 'should receive message and broadcast it', ( done ) => {
			customerEvents.once( 'message', ( chat, { id, text, timestamp, user, meta, context } ) => {
				equal( chat.id, mockUser.id )
				equal( chat.id, context )
				equal( id, 'message-id' )
				equal( text, 'hello world' )
				ok( timestamp )
				ok( meta )
				deepEqual( user, {
					id: mockUser.id,
					displayName: mockUser.displayName,
					avatarURL: mockUser.avatarURL
				} )
				done()
			} )
			client.emit( 'message', { id: 'message-id', text: 'hello world', meta: {} } )
		} )

		it( 'should receive message via event', ( done ) => {
			client.once( 'message', ( message ) => {
				equal( message.text, 'hello' )
				done()
			} )
			customerEvents.emit( 'receive', { id: mockUser.id }, { context: mockUser.id, text: 'hello', user: mockUser } )
		} )
	} )

	it( 'should allow connections', () => {
		let connected = false
		customer( { on: ( event, listener ) => {
			equal( event, 'connection' )
			equal( typeof( listener ), 'function' )
			connected = true
		}} )
		ok( connected )
	} )

	it( 'should emit connection', ( done ) => {
		const customers = customer( server )
		customers.on( 'connection', () => {
			done()
		} )
		server.emit( 'connection', socket )
	} )

	it( 'should authenticate and init client', ( done ) => {
		customer( server ).once( 'connection', ( _socket, authUser ) => {
			authUser( null, { id: 'user1', username: 'user1' } )
		} )

		client.once( 'init', () => {
			debug( 'socket rooms', socket.rooms )
			contains( socket.rooms, 'user1' )
			done()
		} )

		server.emit( 'connection', socket )
	} )

	it( 'should notify user join and leave', ( done ) => {
		socket.id = 'socket-id'
		let events = auth()
		events.on( 'join', ( { id, socket_id } ) => {
			equal( id, mockUser.id )
			equal( socket_id, 'socket-id' )

			events.on( 'leave', ( { id: left_id, socket_id: left_socket_id } ) => {
				equal( left_id, mockUser.id )
				equal( left_socket_id, 'socket-id' )
				done()
			} )
			client.emit( 'disconnect' )
		} )
	} )

	it( 'should fail to authenticate with invalid token', ( done ) => {
		customer( server ).once( 'connection', ( _socket, authorize ) => authorize( new Error( 'nope' ) ) )
		client.on( 'unauthorized', () => done() )
		server.emit( 'connection', socket )
	} )
} )
