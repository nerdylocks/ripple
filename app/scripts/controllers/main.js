'use strict';

rippleApp.controller('MainCtrl', function ($scope, $rootScope, RippleRemote, RippleFire) {
	
	RippleRemote.init();		
	RippleFire.init('https://nerdylocks.firebaseio.com/ripple/snapshots');

	$scope.connect = function(){
		$rootScope.$emit('CONNECTING');
		RippleRemote.on('transaction_all', handleData);
		$scope.rippledTime = new Date(); //Time stamp
	};

	$scope.disconnect = function(){
		RippleRemote.remote.disconnect();
		$rootScope.$emit('DISCONNECTED');
	};
	
	//Utilities, i.e UI feedback
	var Utilities = { 
		countIndicator : function(currency) {
			var badge = $('.list-group a.' + currency + '.list-group-item');
			badge.addClass('hit');
			setTimeout(function(){
				badge.removeClass('hit');
			}, 140);
		}
	};

	function handleData(data){
		$rootScope.$apply(function(){
			$rootScope.$emit('CONNECTED');
			if(data.engine_result_code == 0){
				if(data.transaction.hasOwnProperty("TakerPays")) {
					if(data.transaction.TakerPays.hasOwnProperty("currency")){
						var _counter = $rootScope.currencyTypes[data.transaction.TakerPays.currency] || $rootScope.currencyTypes['other'];
						$rootScope.currencyTypes[_counter.currency].amount++;
						Utilities.countIndicator(_counter.currency);
					}
				} else if(data.transaction.hasOwnProperty("TakerGets")) {
					if(data.transaction.TakerPays.hasOwnProperty("currency")){
						var _counter = $rootScope.currencyTypes[data.transaction.TakerGets.currency] || $rootScope.currencyTypes['other'];
						$rootScope.currencyTypes[_counter.currency].amount++;
						Utilities.countIndicator(_counter.currency);
					}
				}	
			}
			$rootScope.chartData = [
				{ key: "BTC", y: $rootScope.currencyTypes.BTC.amount+1 },
		    	{ key: "CNY", y: $rootScope.currencyTypes.CNY.amount+1 },
		    	{ key: "USD", y: $rootScope.currencyTypes.USD.amount+1 },
		    	{ key: "AUD", y: $rootScope.currencyTypes.AUD.amount+1 },
		    	{ key: "XRP", y: $rootScope.currencyTypes.XRP.amount+1 },
		    	{ key: "CAD", y: $rootScope.currencyTypes.CAD.amount+1 },
		    	{ key: "EUR", y: $rootScope.currencyTypes.EUR.amount+1 }
			];

		});
	}
	
	//Chart functions
	$scope.xFunction = function(){
        return function(d) {
            return d.key;
        };
    }
    $scope.yFunction = function(){
        return function(d) {
            return d.y;
        };
    }
	
	//Archive
	$scope.snap = function(){

		//Construct archive data model for firebase
		$rootScope.archiveData = {
			data: $rootScope.currencyTypes,
			startTime: $scope.rippledTime,
			endTime: new Date()
		}

		//Persist data to firebase
		$rootScope.snapshots.$add($rootScope.archiveData); 

		//Visual feedback on snap
		angular.forEach($rootScope.chartData, function(key, value){
			Utilities.countIndicator(key.key); 
		});
	}
});

