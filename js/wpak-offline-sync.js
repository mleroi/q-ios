define( [ 'jquery', 'core/theme-app', 'core/modules/persistent-storage', 'core/lib/encryption/sha256' ], 
function ( $, App, Storage, Sha256 ) {
	var offline_sync = {};
 
	/**
	 * Actions pile (FIFO). Stored in local storage.
	 * Array of { action_name: string, action_data: JSON Object }
	 * Array because it must be ordered to dequeue actions chronologically.
	 */
	var stored_actions_data = Storage.get( 'wpak-offline-sync', 'actions_data' );
	if ( stored_actions_data ) { 
		stored_actions_data = JSON.parse( stored_actions_data );
	} else {
		stored_actions_data = [];
	}
	console.log('stored_actions_data', stored_actions_data);
	/**
	 * Registered actions functions
	 * JSON Object  { action_name: { function: action function } }
	 */
	var registered_actions = {};

	/**
	 * Register the function that correspond to the given action name.
	 * This is the function that will be executed when the actions pile will be processed.
	 * 
	 * @param string action_name
	 * @param function action_function
	 */
	offline_sync.registerActionFunction = function( action_name, action_function ) {
		registered_actions[action_name] = { function: action_function };
	};
	
	/**
	 * Try to execute the given action's function with data as argument.
	 * If the action fails, because of network or any reason, it adds the action
	 * and its data to the stored_actions_data pile, that can be processed later
	 * with processActionsPile(), when network is back for example.
	 * The given action must have been registered before with registerActionFunctions().
	 * 
	 * @param string action_name
	 * @param JSON Object data Simple key => value JSON object that will be passed to the executed action.
	 * @param int (Optionnal) action_id Id of the action in the pile. Used only when processing the pile.
	 * @returns jQuery deferred object
	 */
	offline_sync.executeAction = function( action_name, data, action_id ){
		var deferred = $.Deferred();
		
		var pile_processing = (typeof action_id !== 'undefined');
		
		var deferred_result = { data: {}, error: '' };
		
		if ( actionIsRegistered( action_name ) ) {
			
			action = registered_actions[action_name].function;
			
			var network_state = App.getNetworkState( false );
			if ( network_state === 'online' ) {
				
				var action_timestamp = pile_processing ? getActionTimestamp( action_id ) : parseInt( new Date().getTime()/1000 );
				
				//We're online. Try to execute the action:
				//Add timestamp to the data passed to the action, so that the server can know 
				//the original time that the action was first executed.
				action( _.extend( data, { wpak_timestamp: action_timestamp } ) )
					.done( function( answer ) {
						//Action done ok. 
						//We can remove it from registered actions data pile if we are
						//currently processing the pile:
						if ( pile_processing ) {
							removeActionFromActionsDataPile( action_id );
						}
						
						deferred_result.data = answer;
						deferred.resolve( deferred_result );
					} )
					.fail( function( error ) {
						//Store action name and its data in local storage to execute it later.
						//Do this only if we're not currently processing the actions_data pile,
						//because it means the action was alrealy in the pile.
						if ( !pile_processing ) {
							addActionToActionsDataPile( action_name, data );
						}
				
						deferred_result.data = error;
						deferred_result.error = 'action-failed';
						deferred.reject( error );
					});
					
			} else {
				//We're offline. 
				//Store data and sync action in local storage to execute it later
				if ( !pile_processing ) {
					addActionToActionsDataPile( action_name, data );
				}
				
				deferred_result.error = 'offline';
				deferred.reject( deferred_result );
			}
			
		} else {
			
			deferred_result.error = 'action-not-registered';
			deferred.reject( deferred_result );
			
		}
		
		return deferred.promise();
	};
	
	offline_sync.enqueueAction = function( action_name, data ) {
		addActionToActionsDataPile( action_name, data );
	};
	
	offline_sync.getActionsPile = function() {
		return stored_actions_data;
	};
	
	offline_sync.getActionsPileLength = function() {
		return stored_actions_data.length;
	};
	
	offline_sync.getActionsPileData = function() {
		return _.map( stored_actions_data, function( action ) { return action.action_data; } );
	};
	
	offline_sync.processActionsPile = function() {
		
		var _this = this;
		
		var result = { processed_something: false };
		
		var global_deferred = $.Deferred();
		
		if ( stored_actions_data.length ) {
		
			//Parallel cascade:
			var deferred_array = [];
			
			_.each( stored_actions_data, function( action_data, index ) {
				if ( action_data && registered_actions[action_data.action_name] ) {
					var action_deferred = _this.executeAction( action_data.action_name, action_data.action_data, action_data.id );
					deferred_array.push( action_deferred );
				}
			} );

			$.when.apply( $, deferred_array )
				.done( function() {
					result.processed_something = true;
					global_deferred.resolve( result );
				} )
				.fail( function( error ) {
					//If any of the parallel cascade actions failed, we come here.
					//It means that maybe some actions were successful but not all of them.
					global_deferred.reject( error );
				});
				
		} else {
			
			result.processed_something = false;
			global_deferred.resolve( result );
			
		}
			
		return global_deferred.promise();
	};
	
	/**
	 * Remove all occurences of the given action name in the pile.
	 * @param string action_name
	 */
	offline_sync.removeActionByNameFromPile = function( action_name ) {
		removeActionByNameFromActionsDataPile( action_name );
		
		//Do a bit of cleaning when finished:
		cleanActionsDataPile();
	};
	
	var cleanActionsDataPile = function() {
		//Clean up actions data pile. If no function was registered for stored action data,
		//remove the action from stored actions data pile:
		var index_to_clean = [];
		
		_.each( stored_actions_data, function( action_data, index ) {
			if ( !action_data || !registered_actions[action_data.action_name] ) {
				index_to_clean.push[index];
			}
		} );
		
		if ( index_to_clean.length ) {
			for( var i=index_to_clean.length-1; i>=0; i-- ) {
				stored_actions_data.splice( index_to_clean[i], 1 );
			}
			Storage.set( 'wpak-offline-sync', 'actions_data', JSON.stringify( stored_actions_data ) );
		}
	};
	
	var actionIsRegistered = function( action_name ) {
		return registered_actions.hasOwnProperty( action_name );
	};
	
	var addActionToActionsDataPile = function( action_name, data ) {
		if ( actionIsRegistered( action_name ) ) {
			var id = Sha256( 'action_name-' + JSON.stringify( data ) );
			stored_actions_data.push( { id: id, action_name: action_name, action_data: data, timestamp: parseInt( new Date().getTime()/1000 )  } );
			Storage.set( 'wpak-offline-sync', 'actions_data', JSON.stringify( stored_actions_data ) );
		}
	};
	
	var removeActionFromActionsDataPile = function( action_id ) {
		var index_found = findActionDataById( action_id );
		if ( index_found !== false ) {
			stored_actions_data.splice( index_found, 1 );
			Storage.set( 'wpak-offline-sync', 'actions_data', JSON.stringify( stored_actions_data ) );
		}
	};
	
	var removeActionByNameFromActionsDataPile = function( action_name ) {
		var index_found = findActionsDataByName( action_name );
		if ( index_found.length ) {
			for( var i=index_found.length-1; i>=0; i-- ) {
				stored_actions_data.splice( index_found[i], 1 );
			}
			Storage.set( 'wpak-offline-sync', 'actions_data', JSON.stringify( stored_actions_data ) );
		}
	};
	
	var findActionsDataByName = function( action_name ) {
		var index_found = [];
		_.each( stored_actions_data, function( action_data, index ) {
			if ( action_data && action_data.action_name === action_name ) {
				index_found.push( index );
			}
		} );
		return index_found;
	};
	
	var findActionDataById = function( action_id ) {
		var index_found = false;
		_.each( stored_actions_data, function( action_data, index ) {
			if ( action_data && action_data.id === action_id ) {
				index_found = index;
			}
		} );
		return index_found;
	};
	
	var getActionTimestamp = function( action_id ) {
		var action_timestamp = false;
		_.each( stored_actions_data, function( action_data ) {
			if ( action_data && action_data.id === action_id ) {
				action_timestamp = action_data.timestamp;
			}
		} );
		return action_timestamp;
	};
	
	return offline_sync;
} );


