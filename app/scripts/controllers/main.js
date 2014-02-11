'use strict';

angular.module('controllers', [])
.controller('MainCtrl', function ($scope, WebSocket) {
	WebSocket.onopen(function(){
		console.log('connection');
		WebSocket.send('{"command":"subscribe","id":0,"streams":["ledger"]}');
	});
	$scope.socketResp = [];
	WebSocket.onmessage(function(event){
		$scope.socketResp.push(JSON.parse(event.data));
	});
});
