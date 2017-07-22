<?php

/**
 * Catch form data that is sent trough liveQuery and save it in a WordPress post
 */
add_filter( 'wpak_live_query', 'process_form_data', 10, 3 );
function process_form_data( $service_answer, $query_params ) {

	//Check that our 'my_action' action is called:
	if ( isset( $query_params['livequery_action'] ) && $query_params['livequery_action'] === 'send_form' ) {

		//Prepare our custom answer:
		$result = array( 'ok' => 0, 'error' => '', 'data' => '' );

		if ( !empty( $query_params['form_data'] ) ) {
		
			$form_data = $query_params['form_data'];
			
			if ( !empty( $form_data['firstname'] ) && !empty( $form_data['lastname'] ) ) {

				$firstname = $form_data['firstname'];
				$lastname = $form_data['lastname'];
				
				//Timestamp of the moment that the form was submitted. If the form was submitted
				//offline and synced with server later, this is the timestamp of the very first 
				//submission of the form. ('wpak_timestamp' value is automatically added 
				//by WP-AppKit to the form data in the OfflineSync module).
				$timestamp = $form_data['wpak_timestamp'];

				//Create new post containing sent form data:
				$new_post = array(
					'post_type' => 'post',
					'post_title' => "Form submission : ". $firstname ." ". $lastname,
					'post_content' => "Firstname: $firstname<br>Lastname: $lastname",
					'post_status' => 'publish',
					'post_author' => 1,
					'post_date_gmt' => date( 'Y-m-d H:i:s', $timestamp )
				);

				$new_post_id = wp_insert_post( $new_post );
				$post_id = !empty( $new_post_id ) && !is_wp_error( $new_post_id ) ? (int)$new_post_id : 0;

				if ( !empty( $post_id ) ) {

					//If everything went ok, set webservice answer to ok = 1:
					$result['ok'] = 1;
					$result['data'] = array( 'post_id' => $post_id, 'form_data' => $form_data );

				} else {
					$result['error'] = 'post-insertion-failed';
				}

			} else {
				$result['error'] = 'wrong-form-fields';
			}
			
		} else {
			$result['error'] = 'no-form-data-found';
		}

		$service_answer['livequery_result'] = $result;
	}

	return $service_answer;
}
