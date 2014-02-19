'use strict';

var rippleApp = angular.module('rippleTestApp', [
	'ngCookies',
	'ngResource',
	'ngSanitize',
	'ngRoute',
	'nvd3ChartDirectives',
	'firebase'
]);

rippleApp.config(function ($routeProvider) {
	$routeProvider
	.when('/', {
		templateUrl: 'views/main.html',
		controller: 'MainCtrl'
	})
	.when('/archives', {
		templateUrl: 'views/archives.html',
		controller: 'MainCtrl'
	})
	.otherwise({
		redirectTo: '/'
	});
});
