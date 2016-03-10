const asCallback = ( { resolve, reject } ) => ( error, result ) => {
	if ( error ) return reject( error )
	resolve( result )
}

const connect = ( { events, socket } ) => new Promise( ( resolve, reject ) => {
	events.emit( 'connection', socket, asCallback( { resolve, reject } ) )
} )

const rejectAndClose = ( socket ) => () => {
	socket.emit( 'unauthorized' )
	socket.close()
}

export const onConnection = ( { events, socket } ) => ( success ) => connect( { events, socket } ).then( success, rejectAndClose( socket ) )