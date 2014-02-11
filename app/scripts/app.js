'use strict';

angular.module('rippleTestApp', [
'ngCookies',
'ngResource',
'ngSanitize',
'ngRoute',
'angular-websocket',
'controllers'
])
.config(function(WebSocketProvider){
	WebSocketProvider
	.prefix('')
	.uri('wss://s1.ripple.com');
})
.config(function ($routeProvider) {
	$routeProvider
	.when('/', {
		templateUrl: 'views/main.html',
		controller: 'MainCtrl'
	})
	.otherwise({
		redirectTo: '/'
	});
});
