'use strict';

rippleApp.controller('MainCtrl', function ($scope, $rootScope, RippleRemote) {
	
	RippleRemote.init();		

	$scope.connect = function(){
		$rootScope.$emit('CONNECTING');
		RippleRemote.on('transaction_all', handleData);
	};
	
	function handleData(data){
		$rootScope.$apply(function(){
			$rootScope.$emit('CONNECTED');
			console.log(data);
			if(data.engine_result_code == 0){
				if(data.transaction.hasOwnProperty("TakerPays")) {
					if(data.transaction.TakerPays.hasOwnProperty("currency")){
						var _counter = $rootScope.currencyTypes[data.transaction.TakerPays.currency] || $rootScope.currencyTypes['other'];
						$rootScope.currencyTypes[_counter.currency].amount = $rootScope.currencyTypes[_counter.currency].amount+1;
					}
				} else if(data.transaction.hasOwnProperty("TakerGets")) {
					if(data.transaction.TakerPays.hasOwnProperty("currency")){
						var _counter = $rootScope.currencyTypes[data.transaction.TakerGets.currency] || $rootScope.currencyTypes['other'];
						$rootScope.currencyTypes[_counter.currency].amount = $rootScope.currencyTypes[_counter.currency].amount+1;
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
		    	{ key: "EUR", y: $rootScope.currencyTypes.EUR.amount+1 },
		    	{ key: "other", y: $rootScope.currencyTypes.other.amount+1 }
			];	
		});
	}

	
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
	

});
