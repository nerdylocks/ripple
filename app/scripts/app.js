'use strict';

var rippleApp = angular.module('rippleTestApp', [
	'ngCookies',
	'ngResource',
	'ngSanitize',
	'ngRoute'
]);

rippleApp.config(function ($routeProvider) {
	$routeProvider
	.when('/', {
		templateUrl: 'views/main.html',
		controller: 'MainCtrl'
	})
	.otherwise({
		redirectTo: '/'
	});
});
