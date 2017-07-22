define( [ 'jquery', 'core/theme-app', 'theme/js/wpak-offline-sync' ], 
function ( $, App, OfflineSync ) {
	
	//Add form screen and set it as default route:
	App.addCustomRoute( 'form', 'form' );
	
	App.filter( 'default-route', function ( default_route ) {
		default_route = 'form';
		return default_route;
	} );
	
	//Add stats screen where we can see how many form submissions are wainting
	//to be synced with server and sync them manually:
	App.addCustomRoute( 'form-sync-state', 'form-sync-state' );
	
	//Pass form submissions waiting for sync to the form-sync-state screen so that
	//we can display offline submitted forms that are waiting to be synced with server:
	App.filter( 'template-args', function ( template_args, view_type, view_template ) {
		if ( view_template === 'form-sync-state' ) { 
			template_args.forms_waiting_sync = OfflineSync.getActionsPileData();
			
			//Also pass online info to the template:
			var network_state = App.getNetworkState( false );
			template_args.online = network_state === 'online';
		} 
		return template_args;
	} );
	
	//Add form stats screen to app navigation:
	App.filter( 'menu-items', function( menu_items ){ 
		menu_items.push( { id:'form', label:'Form', type:'custom', link:'#form' } );
		menu_items.push( { id:'form-sync-state', label:'Server sync', type:'custom', link:'#form-sync-state' } );
		return menu_items;
	} );
	
	//Don't automatically refresh content at app launch so that we can see
	//form submission synchronization messages
	App.setParam( 'refresh-at-app-launch', false );
	
	//This is the function that send form data to server using liveQuery.
	//We will then register it into the OfflineSync so that it can be executed
	//automatically when network is available.
	var send_form_to_server = function( form_data ) {
		
		var deferred = $.Deferred();
		
		var query_args = {
			livequery_action: 'send_form',
			form_data: form_data
		};

		//Define query options:
		var options = {
			auto_interpret_result: false, //This is to tell WPAK that you're doing your own custom query
			success: function ( answer ) { 
				//Post data was successfully received by server
				if ( answer.livequery_result.ok === 1 ) { //Post data was processed ok
					console.log( 'liveQuery answer', answer );
					deferred.resolve( { ok:true } );
				} else {
					//Error when processing form data: return the error
					console.log( 'liveQuery error: ', answer.livequery_result.error );
					deferred.resolve( { ok:false, error: answer.livequery_result.error } ); 
				}
			},
			error: function ( error ) {
				//This is if the web service call failed
				console.log( 'ajax error: ', error );
				deferred.reject();
			}
		};

		//Send our meta update query to the server:
		App.liveQuery( query_args, options );
		
		return deferred.promise();
	};
	
	//Register the "send_form" action into the OfflineSync module:
	OfflineSync.registerActionFunction(	'send_form', send_form_to_server );
	
	//When the form is submitted, try to send form data to the server.
	//If sending data fails (because offline or bad network) the action and the
	//corresponding data are saved in local storage (this is handle by the OfflineSync module):
	$( "#app-layout" ).on( "submit", ".offline-capable-form", function ( e ) {
		
		e.preventDefault();
		
		var $submit_button = $( 'input[type="submit"]', this );
		
		var default_message = $submit_button.val();
		$submit_button.val( 'Sending...' );
		
		//Retrieve and check form data:
		var firstname = $( 'input[name="firstname"]', this ).val();
		var lastname = $( 'input[name="lastname"]', this ).val();
		if ( !firstname.length || !lastname.length ) {
			$submit_button.val( default_message );
			showMessage( "Error: form fieds can't be empty." );
			return;
		}
		
		var sent_data = {
			firstname: firstname,
			lastname: lastname
		};
		
		OfflineSync.executeAction( 'send_form', sent_data )
			.done( function( result ) {
				//Data sent to server ok, meaning there was no network problem.
				//Now we check if there was error processing form data:
				var form_submission_answer = result.data;
				if ( form_submission_answer.ok ) {
					$submit_button.val( default_message );
					showMessage( 'Form data sent successfully! :)' );
				} else {
					$submit_button.val( default_message );
					showMessage( 'Error when processing form: '+ form_submission_answer.error );
				}
			} )
			.fail( function( error ) {
				//Data could not be sent to server and has been added to execution pile.
				$submit_button.val( default_message );
				showMessage('Offline. Form data will be sent when network is back.');
			});
		
	} );
	
	//Try to synchronize offline form data when starting the app:
	App.on( 'info:app-ready', function () {
		sync_offline_forms();
	} );
	
	
	App.on( 'network:online', function() {
		//Launch offline form data synchronization when finding network
		//sync_offline_forms();
		
		//If we're on 'form-sync-state' screen, rerender it:
		var current_screen = App.getCurrentScreen();
		if ( current_screen.item_id === 'form-sync-state' ) {
			App.rerenderCurrentScreen();
		}
	} );
	
	App.on( 'network:offline', function() {
		var current_screen = App.getCurrentScreen();
		if ( current_screen.item_id === 'form-sync-state' ) {
			App.rerenderCurrentScreen();
		}
	} );
	
	//Link to sync offline form data manually:
	$( "#app-layout" ).on( "click", ".sync-now", function ( e ) {
		e.preventDefault();
		
		var $sender_el = $( this );
		
		var default_message = $sender_el.html();
		$sender_el.html( 'Syncing...' );
		
		sync_offline_forms()
			.done( function() {
				$sender_el.html( default_message );
				App.rerenderCurrentScreen();
			} )
			.fail( function(){
				$sender_el.html( default_message );
				App.rerenderCurrentScreen();
			});
		
	} );
	
	//Launch offline form data synchronization:
	var sync_offline_forms = function() {
		
		var deferred = $.Deferred();
		
		OfflineSync.processActionsPile()
			.done( function( result ) {
				if ( result.processed_something ) {
					showMessage( 'Offline forms data synced with server successfully!' );
				}
				deferred.resolve( result );
			})
			.fail( function( error ) {
				showMessage( 'Sync failed. Check network state and try again!' );
				deferred.reject( error );
			});
		
		return deferred.promise();
	};
	
	//Display a message in the message bar
	function showMessage(msgText) {
		$("#app-message-bar").html(msgText);
		$("#app-message-bar").removeClass("message-off").addClass("message-on");
		setTimeout(hideMessage,3000);
	}

    //Hide the message bar
	function hideMessage() {
		$("#app-message-bar").removeClass("message-on").addClass("message-off");	
		$("#app-message-bar").html("");
	}
	
} );


