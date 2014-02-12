'use strict';

rippleApp.controller('MainCtrl', function ($scope, $rootScope, RippleRemote) {
	
	RippleRemote.init();		

	$scope.connect = function(){
		$rootScope.$emit('CONNECTING');
		RippleRemote.on('transaction_all', handleData);
	}
	
	function handleData(data){
		$rootScope.$apply(function(){
			$rootScope.$emit('CONNECTED');
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
		});
	}

});
